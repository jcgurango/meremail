import { ref } from 'vue'
import type {
  BootstrapResponse,
  ChangesResponse,
  ThreadsResponse,
  FolderPageResponse,
  ActionsResponse,
  SyncAction,
} from '@meremail/shared/sync-types'
import { db, getMeta, setMeta, type PendingAction, type UploadAction } from './db'
import {
  applyChanges,
  storeThreads,
  removeThreads,
  evictExpired,
  clearServerData,
  setServerCounts,
  setWatermark,
} from './store'
import { reapplyPending, describeAction, setEnqueueListener, inFlight } from './actions'
import { getFile, deleteFiles, draftAttachmentKey } from './files'

/**
 * The sync engine: sends queued actions to the server and pulls changes back.
 *
 * The UI never waits on this. It reads the local database; a sync just makes
 * the local database more current.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const POLL_INTERVAL_MS = 60 * 1000
const THREADS_PER_FETCH = 40
const ACTIONS_PER_BATCH = 50
// An action that keeps failing unexpectedly is given up on, so it can't block the queue forever
const MAX_ATTEMPTS = 5

// ============== State ==============

export const isSyncing = ref(false)
export const isOnline = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
/** Why the last sync stopped early, if it did. Null while offline - that isn't an error. */
export const syncError = ref<string | null>(null)
/** True if the last sync couldn't reach the server at all */
export const serverUnreachable = ref(false)

let authRequiredHandler: (() => void) | null = null

/** Called when the server says we're no longer logged in */
export function onAuthRequired(handler: () => void): void {
  authRequiredHandler = handler
}

// ============== HTTP ==============

class NetworkError extends Error {}
class AuthError extends Error {}
class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch {
    throw new NetworkError('Server unreachable')
  }

  if (response.status === 401) throw new AuthError('Not logged in')
  return response
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await request(path, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new HttpError(response.status, `Server error (${response.status})`)
  }
  return response.json() as Promise<T>
}

// ============== Fetching threads ==============

/**
 * Fetch whole threads and store them. Threads the server no longer has are
 * removed locally.
 */
async function fetchAndStore(threadIds: number[], options: { touch: boolean }): Promise<void> {
  for (let i = 0; i < threadIds.length; i += THREADS_PER_FETCH) {
    const ids = threadIds.slice(i, i + THREADS_PER_FETCH)
    const result = await api<ThreadsResponse>('/api/sync/threads', { ids })
    await storeThreads(result.threads, result.emails, options)
    await removeThreads(result.missing)
  }
}

/**
 * Make sure a thread is held locally, fetching it if needed. Used when the
 * user opens something outside the local window (a search hit, an old link);
 * the thread is then kept for the usual retention period.
 */
export async function ensureThreads(threadIds: number[]): Promise<void> {
  const held = await db.threads.bulkGet(threadIds)
  const missing = threadIds.filter((_, i) => !held[i])
  if (missing.length === 0) return

  await fetchAndStore(missing, { touch: true })
  await reapplyPending()
}

/**
 * Page further back through a folder than is held locally.
 * Returns the date to continue from, or null when the folder is exhausted.
 */
export async function loadOlderThreads(
  folderId: number,
  before: number | null,
  options: { remember: boolean }
): Promise<number | null> {
  const params = new URLSearchParams({ folderId: String(folderId) })
  if (before !== null && isFinite(before)) params.set('before', String(before))

  const page = await api<FolderPageResponse>(`/api/sync/folder-threads?${params}`)
  await storeThreads(page.threads, page.emails, { touch: true })
  await reapplyPending()

  const next = page.hasMore ? page.nextBefore : null
  if (options.remember) {
    // The local copy of this folder is now complete this far back
    await setWatermark(folderId, next ?? 0)
  }
  return next
}

// ============== Sending actions ==============

class RetryLater extends Error {}

/**
 * Give up on an action: take it off the queue, tell the user, and undo its
 * local effect by re-reading what it touched from the server.
 */
async function failAction(action: PendingAction, error: string, rollback: Set<number>): Promise<void> {
  const subject = await describeAction(action)
  await db.actions.delete(action.seq!)
  await db.failures.add({ type: action.type, error, failedAt: Date.now(), subject })

  switch (action.type) {
    case 'thread.move':
    case 'thread.trash':
    case 'thread.restore':
    case 'thread.delete':
    case 'thread.replyLater':
    case 'thread.setAside':
      rollback.add(action.payload.threadId)
      break
    case 'draft.send':
      await db.drafts.update(action.payload.draft.id, { sending: false })
      break
    case 'draft.upload': {
      const draft = await db.drafts.get(action.payload.draftId)
      if (draft) {
        await db.drafts.update(draft.id, {
          attachments: draft.attachments.filter(a => a.id !== action.payload.attachmentId),
        })
      }
      await deleteFiles([draftAttachmentKey(action.payload.attachmentId)])
      break
    }
  }
}

async function noteAttempt(action: PendingAction, error: string, rollback: Set<number>): Promise<void> {
  const attempts = action.attempts + 1
  if (attempts >= MAX_ATTEMPTS) {
    await failAction(action, error, rollback)
    return
  }
  await db.actions.update(action.seq!, { attempts, lastError: error })
  throw new RetryLater(error)
}

async function uploadAttachment(action: PendingAction & UploadAction, rollback: Set<number>): Promise<void> {
  const { draftId, attachmentId, filename, mimeType, isInline } = action.payload

  const blob = await getFile(draftAttachmentKey(attachmentId))
  if (!blob) {
    await failAction(action, 'The file is no longer available on this device', rollback)
    return
  }

  const form = new FormData()
  form.append('file', new File([blob], filename, { type: mimeType }))
  form.append('draftId', draftId)
  form.append('isInline', String(isInline))

  const response = await request(`/api/draft-attachments/${attachmentId}`, { method: 'PUT', body: form })

  if (response.ok) {
    await db.transaction('rw', db.actions, db.drafts, async () => {
      await db.actions.delete(action.seq!)
      const draft = await db.drafts.get(draftId)
      if (draft) {
        await db.drafts.update(draftId, {
          attachments: draft.attachments.map(a => a.id === attachmentId ? { ...a, pending: false } : a),
        })
      }
    })
    return
  }

  const message = await response.json().then((b: { error?: string }) => b.error, () => undefined)
    || `Upload failed (${response.status})`
  if (response.status >= 400 && response.status < 500) {
    await failAction(action, message, rollback)
  } else {
    await noteAttempt(action, message, rollback)
  }
}

async function sendBatch(batch: PendingAction[], rollback: Set<number>): Promise<void> {
  const actions = batch.map(({ id, type, payload }) => ({ id, type, payload }) as SyncAction)
  const response = await api<ActionsResponse>('/api/sync/actions', { actions })
  const results = new Map(response.results.map(r => [r.id, r]))

  for (const action of batch) {
    const result = results.get(action.id)
    // The server stops at the first unexpected failure; the rest go again next time
    if (!result) break

    if (result.ok) {
      await db.actions.delete(action.seq!)
    } else if (result.retry) {
      await noteAttempt(action, result.error || 'Unknown error', rollback)
    } else {
      await failAction(action, result.error || 'Rejected by the server', rollback)
    }
  }
}

async function flushActions(): Promise<void> {
  const rollback = new Set<number>()

  try {
    for (;;) {
      const queued = await db.actions.orderBy('seq').limit(ACTIONS_PER_BATCH).toArray()
      const first = queued[0]
      if (!first) break

      // Uploads go one at a time; everything else is batched up to the next upload
      const firstUpload = queued.findIndex(a => a.type === 'draft.upload')
      const batch = first.type === 'draft.upload' ? [first] : queued.slice(0, firstUpload === -1 ? undefined : firstUpload)

      batch.forEach(a => inFlight.add(a.id))
      try {
        if (first.type === 'draft.upload') {
          await uploadAttachment(first, rollback)
        } else {
          await sendBatch(batch, rollback)
        }
      } finally {
        batch.forEach(a => inFlight.delete(a.id))
      }
    }
  } finally {
    if (rollback.size > 0) {
      await fetchAndStore([...rollback], { touch: false }).catch(() => {})
    }
  }
}

// ============== Pulling ==============

async function bootstrap(): Promise<void> {
  const boot = await api<BootstrapResponse>('/api/sync/bootstrap')

  await db.transaction('rw', [db.folders, db.contacts, db.drafts, db.actions, db.threads, db.meta], async () => {
    await db.folders.clear()
    await db.folders.bulkPut(boot.folders)
    await db.contacts.clear()
    await db.contacts.bulkPut(boot.contacts)

    // Drafts the server doesn't know about survive only if they're still waiting to be sent to it
    const serverDrafts = new Set(boot.drafts.map(d => d.id))
    const waiting = new Set<string>()
    for (const action of await db.actions.toArray()) {
      if (action.type === 'draft.save' || action.type === 'draft.send') waiting.add(action.payload.draft.id)
    }
    for (const draft of await db.drafts.toArray()) {
      if (!serverDrafts.has(draft.id) && !waiting.has(draft.id)) {
        await db.drafts.delete(draft.id)
      }
    }
    await db.drafts.bulkPut(boot.drafts)

    await setMeta('config', boot.config)
    await setMeta('cursor', boot.cursor)
    await setMeta('floor', boot.serverTime - boot.config.windowDays * DAY_MS)
    await setMeta('watermarks', {})
    await setMeta('bootstrapQueue', boot.threadIds)
    await setServerCounts(boot.counts)
  })

  await reapplyPending()
}

/**
 * Fetch the threads listed by bootstrap, newest first. The remaining list is
 * saved after every batch, so an interrupted first sync picks up where it left off.
 */
async function drainBootstrapQueue(): Promise<void> {
  for (;;) {
    const queue = (await getMeta('bootstrapQueue')) || []
    if (queue.length === 0) return

    await fetchAndStore(queue.slice(0, THREADS_PER_FETCH), { touch: true })
    await setMeta('bootstrapQueue', queue.slice(THREADS_PER_FETCH))
    await reapplyPending()
  }
}

async function startOver(): Promise<void> {
  await clearServerData()
  await bootstrap()
  await drainBootstrapQueue()
}

async function pullChanges(): Promise<void> {
  for (;;) {
    const cursor = await getMeta('cursor')
    const page = await api<ChangesResponse>(`/api/sync/changes?since=${cursor}`)

    if (page.reset) {
      // Our cursor is too old to resume from
      await startOver()
      continue
    }

    const result = await applyChanges(page)
    await fetchAndStore(result.fetch, { touch: true })
    await fetchAndStore(result.refresh, { touch: false })
    await setMeta('cursor', page.cursor)
    await reapplyPending()

    if (page.counts) await setServerCounts(page.counts)
    if (!page.hasMore) return
  }
}

async function cycle(): Promise<void> {
  // A change that can't be sent right now shouldn't stop us receiving
  let unsent: string | null = null
  try {
    await flushActions()
  } catch (e) {
    if (!(e instanceof RetryLater)) throw e
    unsent = e.message
  }

  const cursor = await getMeta('cursor')
  if (cursor === undefined) {
    await bootstrap()
  } else {
    // After a long absence the feed no longer covers the gap; start over
    const lastSyncedAt = await getMeta('lastSyncedAt')
    const windowDays = (await getMeta('config'))?.windowDays ?? 30
    if (lastSyncedAt !== undefined && Date.now() - lastSyncedAt > windowDays * DAY_MS) {
      await clearServerData()
      await bootstrap()
    }
  }

  await drainBootstrapQueue()
  await pullChanges()
  await evictExpired()
  await setMeta('lastSyncedAt', Date.now())

  if (unsent) {
    throw new Error(`Some changes couldn't be sent yet: ${unsent}`)
  }
}

// ============== Running ==============

let running: Promise<void> | null = null
let rerun = false

async function run(): Promise<void> {
  isSyncing.value = true
  try {
    await cycle()
    syncError.value = null
    serverUnreachable.value = false
  } catch (e) {
    serverUnreachable.value = e instanceof NetworkError
    if (e instanceof NetworkError) {
      // Offline or server down - not worth shouting about, we'll try again
      syncError.value = null
    } else if (e instanceof AuthError) {
      syncError.value = 'Not logged in'
      authRequiredHandler?.()
    } else {
      console.error('[Sync] Failed:', e)
      syncError.value = e instanceof Error ? e.message : 'Sync failed'
    }
  } finally {
    isSyncing.value = false
  }
}

/**
 * Sync now. If a sync is already running, another one is run straight after
 * it so that whatever prompted this call is picked up.
 */
export function syncNow(): Promise<void> {
  if (running) {
    rerun = true
    return running
  }

  // Only one tab syncs at a time; the others see the result through the shared database
  const locked = typeof navigator !== 'undefined' && 'locks' in navigator
    ? navigator.locks.request('meremail-sync', { ifAvailable: true }, lock => lock ? run() : undefined)
    : run()

  running = Promise.resolve(locked).finally(() => {
    running = null
    if (rerun) {
      rerun = false
      void syncNow()
    }
  })
  return running
}

let soonTimer: ReturnType<typeof setTimeout> | null = null

function syncSoon(): void {
  if (soonTimer) clearTimeout(soonTimer)
  soonTimer = setTimeout(() => {
    soonTimer = null
    void syncNow()
  }, 300)
}

let started = false

/**
 * Start syncing: once immediately, then on an interval while the page is
 * visible, when connectivity returns, and shortly after any local change.
 */
export function startSync(): void {
  if (started) return
  started = true

  setEnqueueListener(syncSoon)

  window.addEventListener('online', () => {
    isOnline.value = true
    void syncNow()
  })
  window.addEventListener('offline', () => {
    isOnline.value = false
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow()
  })

  void syncNow()
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow()
  }, POLL_INTERVAL_MS)
}
