import type {
  SyncThread,
  SyncEmail,
  SyncParticipant,
  SyncCounts,
  ChangesResponse,
} from '@meremail/shared/sync-types'
import { db, getMeta, setMeta, type LocalThread, type LocalEmail, type LocalDraft } from './db'
import { deleteFiles, attachmentKey, draftAttachmentKey } from './files'

/**
 * Writes server data into the local database and decides what to keep.
 *
 * Nothing here talks to the network - see sync.ts for that.
 */

type ChangesPage = Exclude<ChangesResponse, { reset: true }>

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_WINDOW_DAYS = 30

// ============== Derived thread fields ==============

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

export function makeSnippet(email: Pick<SyncEmail, 'contentText' | 'contentHtml'>): string {
  const text = email.contentText || ''
  // Some senders put raw CSS in the text part
  const looksLikeCss = /\{[^}]*:[^}]*\}|@media|@font-face|\.[\w-]+\s*\{/i.test(text.substring(0, 500))
  if (text && !looksLikeCss) {
    return text.substring(0, 150)
  }
  return stripHtml(email.contentHtml || '').substring(0, 150)
}

export function toLocalEmail(email: SyncEmail): LocalEmail {
  return { ...email, unread: email.readAt === null ? 1 : 0 }
}

type DerivedFields = Pick<LocalThread, 'latestAt' | 'unreadCount' | 'totalCount' | 'queuedCount' | 'snippet' | 'participants'>

export function summarizeEmails(emails: LocalEmail[], fallbackLatestAt: number | null): DerivedFields {
  const ordered = [...emails].sort((a, b) => a.date - b.date)
  const latest = ordered[ordered.length - 1]

  // Everyone but me, senders taking precedence over recipients
  const participants = new Map<number, SyncParticipant>()
  for (const email of ordered) {
    const people = [...(email.sender ? [email.sender] : []), ...email.recipients]
    for (const person of people) {
      if (person.isMe) continue
      const existing = participants.get(person.id)
      if (!existing || (person.role === 'from' && existing.role !== 'from')) {
        participants.set(person.id, person)
      }
    }
  }

  return {
    latestAt: latest ? latest.date : fallbackLatestAt,
    unreadCount: emails.filter(e => e.unread).length,
    totalCount: emails.length,
    queuedCount: emails.filter(e => e.status === 'queued').length,
    snippet: latest ? makeSnippet(latest) : '',
    participants: [...participants.values()],
  }
}

/**
 * Recompute the derived fields of threads from the emails held for them.
 * Must be called inside a transaction covering threads and emails.
 */
export async function recomputeThreads(threadIds: Iterable<number>): Promise<void> {
  for (const threadId of new Set(threadIds)) {
    const thread = await db.threads.get(threadId)
    if (!thread) continue
    const emails = await db.emails.where('threadId').equals(threadId).toArray()
    await db.threads.update(threadId, summarizeEmails(emails, thread.latestAt))
  }
}

// ============== Unread counts ==============
// The server knows how many threads are unread across the whole mailbox; this
// device only holds part of it. So the displayed count is the server's number,
// adjusted by however much the local unread count has moved since.

export async function localUnreadByFolder(): Promise<Record<number, number>> {
  const counts: Record<number, number> = {}
  await db.threads.each((thread) => {
    if (thread.unreadCount > 0 && thread.folderId !== null) {
      counts[thread.folderId] = (counts[thread.folderId] || 0) + 1
    }
  })
  return counts
}

export async function setServerCounts(counts: SyncCounts): Promise<void> {
  await setMeta('counts', counts)
  await setMeta('countsBaseline', await localUnreadByFolder())
}

export function displayedUnreadCount(
  folderId: number,
  server: SyncCounts | undefined,
  baseline: Record<number, number> | undefined,
  local: Record<number, number>
): number {
  const count = (server?.folders[folderId] ?? 0) + (local[folderId] ?? 0) - (baseline?.[folderId] ?? 0)
  return Math.max(0, count)
}

// ============== Watermarks ==============
// For each folder, the date from which the local copy is complete. Thread
// lists only show threads at or after it; older mail is paged in from the server.

export async function getWatermark(folderId: number): Promise<number> {
  const watermarks = (await getMeta('watermarks')) || {}
  if (watermarks[folderId] !== undefined) return watermarks[folderId]!

  const folder = await db.folders.get(folderId)
  // Folders that don't sync offline hold nothing until they are browsed
  if (folder && !folder.syncOffline) return Infinity

  return (await getMeta('floor')) ?? Infinity
}

export async function setWatermark(folderId: number, value: number): Promise<void> {
  const watermarks = (await getMeta('watermarks')) || {}
  await setMeta('watermarks', { ...watermarks, [folderId]: value })
}

// ============== Storing threads ==============

/**
 * Store complete threads fetched from the server.
 *
 * `touch` restarts the 30-day retention clock: true when the thread was
 * retrieved because of new mail or because the user went looking for it,
 * false when it is just being refreshed.
 */
export async function storeThreads(
  threads: SyncThread[],
  emails: SyncEmail[],
  options: { touch: boolean }
): Promise<void> {
  if (threads.length === 0) return
  const now = Date.now()
  const removedFiles: string[] = []

  await db.transaction('rw', db.threads, db.emails, db.meta, async () => {
    const unreadBefore = await localUnreadByFolder()

    const emailsByThread = new Map<number, LocalEmail[]>()
    for (const email of emails) {
      const list = emailsByThread.get(email.threadId) || []
      list.push(toLocalEmail(email))
      emailsByThread.set(email.threadId, list)
    }

    for (const thread of threads) {
      const existing = await db.threads.get(thread.id)
      const threadEmails = emailsByThread.get(thread.id) || []

      // The server sent the whole thread, so anything else held for it is gone
      const keep = new Set(threadEmails.map(e => e.id))
      const stale = (await db.emails.where('threadId').equals(thread.id).toArray()).filter(e => !keep.has(e.id))
      for (const email of stale) {
        removedFiles.push(...email.attachments.map(a => attachmentKey(a.id)))
      }
      await db.emails.bulkDelete(stale.map(e => e.id))
      await db.emails.bulkPut(threadEmails)

      await db.threads.put({
        ...thread,
        ...summarizeEmails(threadEmails, thread.latestAt),
        retrievedAt: options.touch || !existing ? now : existing.retrievedAt,
      })
    }

    // This is mail the server already counted, so it mustn't move the displayed counts
    const baseline = await getMeta('countsBaseline')
    if (baseline) {
      const unreadAfter = await localUnreadByFolder()
      const adjusted = { ...baseline }
      for (const folderId of new Set([...Object.keys(unreadBefore), ...Object.keys(unreadAfter)].map(Number))) {
        adjusted[folderId] = (adjusted[folderId] || 0) + (unreadAfter[folderId] || 0) - (unreadBefore[folderId] || 0)
      }
      await setMeta('countsBaseline', adjusted)
    }
  })

  await deleteFiles(removedFiles)
}

async function deleteThreadsLocally(threadIds: number[]): Promise<string[]> {
  const fileKeys: string[] = []
  for (const threadId of threadIds) {
    const emails = await db.emails.where('threadId').equals(threadId).toArray()
    for (const email of emails) {
      fileKeys.push(...email.attachments.map(a => attachmentKey(a.id)))
    }
    await db.emails.bulkDelete(emails.map(e => e.id))
    await db.threads.delete(threadId)
  }
  return fileKeys
}

/**
 * Remove threads from this device (they remain on the server)
 */
export async function removeThreads(threadIds: number[]): Promise<void> {
  const fileKeys = await db.transaction('rw', db.threads, db.emails, () => deleteThreadsLocally(threadIds))
  await deleteFiles(fileKeys)
}

// ============== Applying the change feed ==============

export interface ApplyResult {
  /** Threads to fetch in full because they now belong on this device */
  fetch: number[]
  /** Held threads to re-fetch because something in them changed */
  refresh: number[]
}

export async function applyChanges(page: ChangesPage): Promise<ApplyResult> {
  const now = Date.now()
  const fetch = new Set<number>()
  const refresh = new Set<number>()
  const removedFiles: string[] = []

  await db.transaction('rw', [db.folders, db.contacts, db.threads, db.emails, db.drafts, db.meta], async () => {
    await setMeta('config', page.config)
    await db.folders.bulkPut(page.folders)
    await db.contacts.bulkPut(page.contacts)

    const affected = new Set<number>()

    // Deletions
    for (const deletion of page.deleted) {
      switch (deletion.entity) {
        case 'emails': {
          const email = await db.emails.get(Number(deletion.id))
          if (email) {
            removedFiles.push(...email.attachments.map(a => attachmentKey(a.id)))
            await db.emails.delete(email.id)
            affected.add(email.threadId)
          }
          break
        }
        case 'email_threads':
          removedFiles.push(...await deleteThreadsLocally([Number(deletion.id)]))
          break
        case 'drafts': {
          const draft = await db.drafts.get(deletion.id)
          if (draft) {
            removedFiles.push(...draft.attachments.map(a => draftAttachmentKey(a.id)))
            await db.drafts.delete(deletion.id)
          }
          break
        }
        case 'folders':
          await db.folders.delete(Number(deletion.id))
          break
        case 'contacts':
          await db.contacts.delete(Number(deletion.id))
          break
      }
    }

    const folders = new Map((await db.folders.toArray()).map(f => [f.id, f]))
    const syncsOffline = (folderId: number | null) => folderId !== null && folders.get(folderId)?.syncOffline !== false

    // Thread changes: update the ones held here; pick up ones that now belong here
    for (const thread of page.threads) {
      const existing = await db.threads.get(thread.id)
      if (existing) {
        // latestAt is derived from held emails, which are updated below
        const { latestAt: _latestAt, ...fields } = thread
        await db.threads.update(thread.id, fields)
        continue
      }

      const pinned = thread.replyLaterAt !== null || thread.setAsideAt !== null
      const inLocalRange = thread.folderId !== null
        && thread.latestAt !== null
        && syncsOffline(thread.folderId)
        && thread.latestAt >= await getWatermark(thread.folderId)
      if (pinned || inLocalRange) {
        fetch.add(thread.id)
      }
    }

    // New and changed emails
    for (const email of page.emails) {
      const thread = await db.threads.get(email.threadId)
      if (!thread) {
        // Mail for a thread not held here - take the whole thread, unless it's
        // in a folder this device doesn't keep
        if (syncsOffline(email.folderId)) fetch.add(email.threadId)
        continue
      }

      const isNew = !(await db.emails.get(email.id))
      await db.emails.put(toLocalEmail(email))
      affected.add(email.threadId)
      if (isNew) {
        // New mail restarts the thread's retention clock
        await db.threads.update(email.threadId, { retrievedAt: now })
      }
    }

    for (const meta of page.emailMeta) {
      const updated = await db.emails.update(meta.id, { readAt: meta.readAt, unread: meta.readAt === null ? 1 : 0 })
      if (updated) affected.add(meta.threadId)
    }

    // Older emails that changed are not sent in full; refresh their thread if it's here
    for (const ref of page.emailRefs) {
      if (!fetch.has(ref.threadId) && await db.threads.get(ref.threadId)) {
        refresh.add(ref.threadId)
      }
    }

    // Drafts, and the threads they reply into
    for (const draft of page.drafts) {
      const local: LocalDraft = { ...draft }
      await db.drafts.put(local)
      if (draft.threadId !== null && !(await db.threads.get(draft.threadId))) {
        fetch.add(draft.threadId)
      }
    }

    await recomputeThreads(affected)
  })

  await deleteFiles(removedFiles)

  return { fetch: [...fetch], refresh: [...refresh].filter(id => !fetch.has(id)) }
}

// ============== Retention ==============

/**
 * Threads that must stay on this device regardless of age
 */
async function pinnedThreadIds(): Promise<Set<number>> {
  const pinned = new Set<number>()

  for (const draft of await db.drafts.toArray()) {
    if (draft.threadId !== null) pinned.add(draft.threadId)
  }
  for (const action of await db.actions.toArray()) {
    const threadId = (action.payload as { threadId?: unknown }).threadId
    if (typeof threadId === 'number') pinned.add(threadId)
  }

  return pinned
}

/**
 * Drop threads retrieved more than the retention window ago.
 * A thread is kept, whole, for the window from its latest retrieval.
 */
export async function evictExpired(now = Date.now()): Promise<number> {
  const windowDays = (await getMeta('config'))?.windowDays ?? DEFAULT_WINDOW_DAYS
  const cutoff = now - windowDays * DAY_MS
  const pinned = await pinnedThreadIds()

  const expired = (await db.threads.where('retrievedAt').below(cutoff).toArray())
    .filter(t => t.replyLaterAt === null && t.setAsideAt === null && !pinned.has(t.id))
  if (expired.length === 0) return 0

  // The local copy of a folder is no longer complete back past an evicted thread
  const watermarks = { ...((await getMeta('watermarks')) || {}) }
  for (const thread of expired) {
    if (thread.folderId === null || thread.latestAt === null) continue
    const current = watermarks[thread.folderId] ?? await getWatermark(thread.folderId)
    if (thread.latestAt >= current) {
      watermarks[thread.folderId] = thread.latestAt + 1
    }
  }
  await setMeta('watermarks', watermarks)

  await removeThreads(expired.map(t => t.id))
  return expired.length
}

/**
 * Forget everything fetched from the server. Unsent work (drafts and queued
 * actions) is kept.
 */
export async function clearServerData(): Promise<void> {
  const fileKeys: string[] = []
  await db.emails.each((email) => {
    fileKeys.push(...email.attachments.map(a => attachmentKey(a.id)))
  })
  await deleteFiles(fileKeys)

  await db.transaction('rw', [db.folders, db.contacts, db.threads, db.emails, db.meta], async () => {
    await db.folders.clear()
    await db.contacts.clear()
    await db.threads.clear()
    await db.emails.clear()
    await db.meta.clear()
  })
}
