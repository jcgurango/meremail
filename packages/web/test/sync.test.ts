import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {
  SyncThread,
  SyncEmail,
  SyncAction,
  SyncActionResult,
  SyncDraftInput,
  BootstrapResponse,
  ChangesResponse,
} from '@meremail/shared/sync-types'
import { db, getMeta, setMeta } from '@/local/db'
import { syncNow, syncError, serverUnreachable, ensureThreads, loadOlderThreads } from '@/local/sync'
import { enqueue, saveDraft, sendDraft, discardDraft, removeDraftAttachment, reapplyPending } from '@/local/actions'
import { storeThreads, getWatermark } from '@/local/store'
import { putFile, getFile, draftAttachmentKey } from '@/local/files'
import { listFolderThreads } from '@/local/queries'
import { resetDb, makeThread, makeEmail, FOLDERS, CONFIG, DAY, ME } from './helpers'

type Page = Exclude<ChangesResponse, { reset: true }>

/**
 * A stand-in for the server: holds threads and emails, records what it is
 * sent, and answers the sync endpoints.
 */
class FakeServer {
  threads = new Map<number, SyncThread>()
  emails: SyncEmail[] = []
  bootstrapThreadIds: number[] = []
  seq = 100
  /** Queued responses for /changes; when empty, an empty page is returned */
  changes: ChangesResponse[] = []
  receivedActions: SyncAction[] = []
  uploads: { id: string; draftId: string; filename: string }[] = []
  actionResult: (action: SyncAction) => Omit<SyncActionResult, 'id'> = () => ({ ok: true })
  offline = false
  requests: string[] = []

  add(thread: SyncThread, ...emails: SyncEmail[]) {
    this.threads.set(thread.id, thread)
    this.emails.push(...emails)
  }

  page(overrides: Partial<Page> = {}): Page {
    return {
      cursor: this.seq, hasMore: false, serverTime: Date.now(), config: CONFIG,
      folders: [], contacts: [], threads: [], emails: [], emailMeta: [], emailRefs: [], drafts: [], deleted: [],
      counts: { folders: {} },
      ...overrides,
    }
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (this.offline) throw new TypeError('Failed to fetch')

    const url = new URL(String(input), 'http://localhost')
    this.requests.push(`${init?.method || 'GET'} ${url.pathname}`)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

    if (url.pathname === '/api/sync/bootstrap') {
      const body: BootstrapResponse = {
        cursor: this.seq, serverTime: Date.now(), config: CONFIG, folders: FOLDERS,
        contacts: [{ id: ME.id, name: ME.name, email: ME.email, isMe: true, isDefaultIdentity: true }],
        drafts: [], threadIds: this.bootstrapThreadIds, counts: { folders: {} },
      }
      return json(body)
    }

    if (url.pathname === '/api/sync/changes') {
      return json(this.changes.shift() ?? this.page())
    }

    if (url.pathname === '/api/sync/threads') {
      const { ids } = JSON.parse(String(init!.body)) as { ids: number[] }
      const found = ids.filter(id => this.threads.has(id))
      return json({
        threads: found.map(id => this.threads.get(id)),
        emails: this.emails.filter(e => found.includes(e.threadId)),
        missing: ids.filter(id => !this.threads.has(id)),
      })
    }

    if (url.pathname === '/api/sync/folder-threads') {
      const folderId = Number(url.searchParams.get('folderId'))
      const before = url.searchParams.has('before') ? Number(url.searchParams.get('before')) : Infinity
      const threads = [...this.threads.values()]
        .filter(t => t.folderId === folderId && t.latestAt! < before)
        .sort((a, b) => b.latestAt! - a.latestAt!)
      const pageThreads = threads.slice(0, 2)
      return json({
        threads: pageThreads,
        emails: this.emails.filter(e => pageThreads.some(t => t.id === e.threadId)),
        hasMore: threads.length > 2,
        nextBefore: pageThreads.length ? pageThreads[pageThreads.length - 1]!.latestAt : null,
      })
    }

    if (url.pathname === '/api/sync/actions') {
      const { actions } = JSON.parse(String(init!.body)) as { actions: SyncAction[] }
      const results: SyncActionResult[] = []
      for (const action of actions) {
        const result = this.actionResult(action)
        results.push({ id: action.id, ...result })
        if (result.retry) break
        this.receivedActions.push(action)
      }
      return json({ results })
    }

    if (url.pathname.startsWith('/api/draft-attachments/')) {
      const form = init!.body as FormData
      const file = form.get('file') as File
      this.uploads.push({ id: url.pathname.split('/').pop()!, draftId: String(form.get('draftId')), filename: file.name })
      return json({ id: url.pathname.split('/').pop() })
    }

    return json({ error: 'Not found' }, 404)
  }
}

function draftInput(overrides: Partial<SyncDraftInput> = {}): SyncDraftInput {
  return {
    id: 'draft-1', threadId: null, senderId: ME.id, subject: 'Hello', contentText: 'Hi', contentHtml: null,
    inReplyTo: null, forwardedMessageId: null, references: [],
    recipients: [{ email: 'bob@example.com', name: 'Bob', role: 'to' }],
    ...overrides,
  }
}

let server: FakeServer

beforeEach(async () => {
  await resetDb()
  server = new FakeServer()
  vi.stubGlobal('fetch', server.fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('first sync', () => {
  it('downloads the threads the server lists and records where it got to', async () => {
    for (let id = 1; id <= 90; id++) {
      server.add(makeThread(id), makeEmail(id))
      server.bootstrapThreadIds.push(id)
    }

    await syncNow()

    expect(syncError.value).toBeNull()
    expect(await db.threads.count()).toBe(90)
    expect(await db.emails.count()).toBe(90)
    expect(await db.folders.count()).toBe(3)
    expect(await getMeta('cursor')).toBe(100)
    expect(await getMeta('bootstrapQueue')).toEqual([])
    expect(await getMeta('lastSyncedAt')).toBeTypeOf('number')
    // Fetched in batches rather than one enormous request
    expect(server.requests.filter(r => r === 'POST /api/sync/threads').length).toBe(3)
  })

  it('resumes an interrupted download instead of starting again', async () => {
    server.add(makeThread(1), makeEmail(1))
    server.add(makeThread(2), makeEmail(2))
    await setMeta('cursor', 50)
    await setMeta('config', CONFIG)
    await setMeta('bootstrapQueue', [2])

    await syncNow()

    expect(server.requests).not.toContain('GET /api/sync/bootstrap')
    expect((await db.threads.toCollection().primaryKeys())).toEqual([2])
  })
})

describe('pulling changes', () => {
  beforeEach(async () => {
    await syncNow()
    server.requests = []
  })

  it('fetches whole threads for new mail and advances the cursor across pages', async () => {
    server.add(makeThread(5), makeEmail(5), makeEmail(5))
    server.changes = [
      server.page({ cursor: 110, hasMore: true, emails: [server.emails[0]!], counts: undefined }),
      server.page({ cursor: 120, counts: { folders: { 1: 4 } } }),
    ]

    await syncNow()

    expect((await db.threads.get(5))!.totalCount).toBe(2)
    expect(await getMeta('cursor')).toBe(120)
    expect((await getMeta('counts'))!.folders[1]).toBe(4)
  })

  it('starts over when the server says the cursor is too old, keeping unsent work', async () => {
    await storeThreads([makeThread(1)], [makeEmail(1)], { touch: true })
    server.offline = true
    await enqueue({ type: 'thread.setAside', payload: { threadId: 1, value: true } })
    server.offline = false

    server.add(makeThread(2), makeEmail(2))
    server.bootstrapThreadIds = [2]
    server.seq = 500
    server.actionResult = () => ({ ok: false, retry: true, error: 'busy' })
    server.changes = [{ reset: true }]

    await syncNow()

    expect(server.requests).toContain('GET /api/sync/bootstrap')
    expect(await db.threads.toCollection().primaryKeys()).toEqual([2])
    expect(await getMeta('cursor')).toBe(500)
    expect(await db.actions.count()).toBe(1)
  })

  it('starts over after being away longer than the retention window', async () => {
    await storeThreads([makeThread(1)], [makeEmail(1)], { touch: true })
    await setMeta('lastSyncedAt', Date.now() - 45 * DAY)

    await syncNow()

    expect(server.requests).toContain('GET /api/sync/bootstrap')
    expect(await db.threads.count()).toBe(0)
  })

  it('quietly does nothing while offline', async () => {
    server.offline = true
    await syncNow()
    expect(syncError.value).toBeNull()
    expect(serverUnreachable.value).toBe(true)

    server.offline = false
    await syncNow()
    expect(serverUnreachable.value).toBe(false)
  })
})

describe('actions', () => {
  beforeEach(async () => {
    server.add(makeThread(1), makeEmail(1))
    server.bootstrapThreadIds = [1]
    await syncNow()
    server.requests = []
  })

  it('takes effect locally at once, and reaches the server on the next sync', async () => {
    server.offline = true
    await enqueue({ type: 'thread.trash', payload: { threadId: 1 } })

    expect(await db.threads.get(1)).toMatchObject({ folderId: 3, previousFolderId: 1 })
    expect(await db.actions.count()).toBe(1)

    server.offline = false
    await syncNow()

    expect(server.receivedActions.map(a => a.type)).toEqual(['thread.trash'])
    expect(await db.actions.count()).toBe(0)
  })

  it('marks emails read and updates the thread', async () => {
    const emailId = (await db.emails.where('threadId').equals(1).first())!.id
    await enqueue({ type: 'emails.markRead', payload: { emailIds: [emailId] } })

    expect((await db.threads.get(1))!.unreadCount).toBe(0)
    expect((await db.emails.get(emailId))!.readAt).toBeTypeOf('number')
  })

  it('is not undone when older server data arrives before it has been sent', async () => {
    server.offline = true
    await enqueue({ type: 'thread.setAside', payload: { threadId: 1, value: true } })

    // The server's copy doesn't have the change yet
    await storeThreads([makeThread(1)], [makeEmail(1)], { touch: false })
    expect((await db.threads.get(1))!.setAsideAt).toBeNull()

    await reapplyPending()
    expect((await db.threads.get(1))!.setAsideAt).toBeTypeOf('number')
  })

  it('undoes a rejected action and tells the user', async () => {
    server.actionResult = () => ({ ok: false, error: 'Folder not found' })
    await enqueue({ type: 'thread.move', payload: { threadId: 1, folderId: 99 } })
    expect((await db.threads.get(1))!.folderId).toBe(99)

    await syncNow()

    expect((await db.threads.get(1))!.folderId).toBe(1)
    expect(await db.actions.count()).toBe(0)
    const failures = await db.failures.toArray()
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ type: 'thread.move', error: 'Folder not found', subject: 'Move "Thread 1"' })
  })

  it('keeps retrying an action that failed unexpectedly, without holding up incoming mail', async () => {
    server.actionResult = () => ({ ok: false, retry: true, error: 'database is locked' })
    await enqueue({ type: 'thread.setAside', payload: { threadId: 1, value: true } })
    server.add(makeThread(2), makeEmail(2))
    server.changes = [server.page({ emails: [server.emails[1]!] })]

    await syncNow()

    expect(await db.threads.get(2)).toBeDefined()
    expect(syncError.value).toContain('database is locked')
    expect((await db.actions.toArray())[0]).toMatchObject({ attempts: 1, lastError: 'database is locked' })

    // ...but not forever
    for (let i = 0; i < 4; i++) await syncNow()
    expect(await db.actions.count()).toBe(0)
    expect(await db.failures.count()).toBe(1)
  })

  it('sends later actions again when the server stops part-way through a batch', async () => {
    let calls = 0
    server.actionResult = (action) => {
      calls++
      return action.type === 'thread.replyLater' && calls <= 2 ? { ok: false, retry: true, error: 'busy' } : { ok: true }
    }
    server.offline = true
    await enqueue({ type: 'thread.setAside', payload: { threadId: 1, value: true } })
    await enqueue({ type: 'thread.replyLater', payload: { threadId: 1, value: true } })
    await enqueue({ type: 'thread.trash', payload: { threadId: 1 } })
    server.offline = false

    await syncNow()
    expect(server.receivedActions.map(a => a.type)).toEqual(['thread.setAside'])
    expect(await db.actions.count()).toBe(2)

    await syncNow()
    expect(server.receivedActions.map(a => a.type)).toEqual(['thread.setAside', 'thread.replyLater', 'thread.trash'])
    expect(await db.actions.count()).toBe(0)
  })
})

describe('drafts', () => {
  beforeEach(async () => {
    await syncNow()
    server.offline = true
  })

  it('collapses repeated saves into one queued action', async () => {
    await saveDraft(draftInput({ subject: 'H' }))
    await saveDraft(draftInput({ subject: 'He' }))
    await saveDraft(draftInput({ subject: 'Hello' }))

    expect(await db.actions.count()).toBe(1)
    expect((await db.drafts.get('draft-1'))!.subject).toBe('Hello')

    server.offline = false
    await syncNow()
    expect(server.receivedActions).toHaveLength(1)
    expect(server.receivedActions[0]).toMatchObject({ type: 'draft.save', payload: { draft: { subject: 'Hello' } } })
  })

  it('sends with the final content, dropping saves that are no longer needed', async () => {
    await saveDraft(draftInput())
    await sendDraft(draftInput({ contentText: 'Final' }), '<m1@example.com>')

    expect((await db.actions.toArray()).map(a => a.type)).toEqual(['draft.send'])
    expect(await db.drafts.get('draft-1')).toMatchObject({ sending: true, contentText: 'Final' })

    // It shows in the Inbox as queued until the server turns it into an email
    const [item] = await listFolderThreads(1, { from: 0 })
    expect(item).toMatchObject({ type: 'draft', id: 'draft-1', queuedCount: 1, draftCount: 0 })
  })

  it('goes back to being a draft if sending is rejected', async () => {
    await sendDraft(draftInput({ recipients: [] }), '<m1@example.com>')
    server.offline = false
    server.actionResult = () => ({ ok: false, error: 'No recipients specified' })

    await syncNow()

    expect((await db.drafts.get('draft-1'))!.sending).toBe(false)
    expect((await db.failures.toArray())[0]).toMatchObject({ subject: 'Send "Hello"', error: 'No recipients specified' })
  })

  it('uploads attachments before the send that needs them', async () => {
    await saveDraft(draftInput())
    await putFile(draftAttachmentKey('att-1'), new Blob(['hello'], { type: 'text/plain' }), 'note.txt')
    await enqueue({
      type: 'draft.upload',
      payload: { draftId: 'draft-1', attachmentId: 'att-1', filename: 'note.txt', mimeType: 'text/plain', size: 5, isInline: false },
    })
    expect((await db.drafts.get('draft-1'))!.attachments).toEqual([
      { id: 'att-1', filename: 'note.txt', mimeType: 'text/plain', size: 5, isInline: false, pending: true },
    ])
    await sendDraft(draftInput(), '<m1@example.com>')

    server.offline = false
    await syncNow()

    expect(server.uploads).toEqual([{ id: 'att-1', draftId: 'draft-1', filename: 'note.txt' }])
    expect(server.receivedActions.map(a => a.type)).toEqual(['draft.send'])
    const order = server.requests.filter(r => r.includes('draft-attachments') || r.includes('actions'))
    expect(order).toEqual(['PUT /api/draft-attachments/att-1', 'POST /api/sync/actions'])
    expect((await db.drafts.get('draft-1'))!.attachments[0]!.pending).toBe(false)
  })

  it('withdraws an upload that has not started when the attachment is removed', async () => {
    await saveDraft(draftInput())
    await putFile(draftAttachmentKey('att-1'), new Blob(['hello']), 'note.txt')
    await enqueue({
      type: 'draft.upload',
      payload: { draftId: 'draft-1', attachmentId: 'att-1', filename: 'note.txt', mimeType: 'text/plain', size: 5, isInline: false },
    })

    await removeDraftAttachment('draft-1', 'att-1')

    expect((await db.actions.toArray()).map(a => a.type)).toEqual(['draft.save'])
    expect((await db.drafts.get('draft-1'))!.attachments).toEqual([])
    expect(await getFile(draftAttachmentKey('att-1'))).toBeNull()
  })

  it('discarding withdraws everything queued for the draft', async () => {
    await saveDraft(draftInput())
    await discardDraft('draft-1')

    expect(await db.drafts.get('draft-1')).toBeUndefined()
    expect((await db.actions.toArray()).map(a => a.type)).toEqual(['draft.delete'])
  })
})

describe('reaching outside the local window', () => {
  beforeEach(async () => {
    await syncNow()
  })

  it('fetches and keeps a thread that is opened but not held', async () => {
    server.add(makeThread(8, { latestAt: Date.now() - 400 * DAY }), makeEmail(8))
    await ensureThreads([8])

    const thread = (await db.threads.get(8))!
    expect(thread.retrievedAt).toBeGreaterThan(Date.now() - 1000)
  })

  it('pages older mail in and extends how far back the folder list goes', async () => {
    const now = Date.now()
    for (let id = 1; id <= 3; id++) {
      const date = now - (40 + id) * DAY
      server.add(makeThread(id, { latestAt: date }), makeEmail(id, { date }))
    }
    expect(await listFolderThreads(1)).toEqual([])

    const next = await loadOlderThreads(1, await getWatermark(1), { remember: true })
    expect((await listFolderThreads(1)).map(t => t.id)).toEqual([1, 2])
    expect(next).toBe(now - 42 * DAY)

    expect(await loadOlderThreads(1, next, { remember: true })).toBeNull()
    expect((await listFolderThreads(1)).map(t => t.id)).toEqual([1, 2, 3])
    expect(await getWatermark(1)).toBe(0)
  })
})
