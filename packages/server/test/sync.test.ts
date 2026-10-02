import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { sqlite, resolveAttachmentPath } from '@meremail/shared'
import type {
  BootstrapResponse,
  ChangesResponse,
  ThreadsResponse,
  FolderPageResponse,
  ActionsResponse,
  SyncAction,
  SyncDraftInput,
} from '@meremail/shared'
import { setupDatabase, createApp, receive, action, daysAgo, meContactId } from './helpers'
import { changes as changesPage } from '../src/sync/feed'
import { cleanupSyncData } from '../src/sync/maintenance'

type Changes = Exclude<ChangesResponse, { reset: true }>

const app = createApp()

async function get<T>(path: string): Promise<T> {
  const res = await app.request(path)
  expect(res.status).toBe(200)
  return res.json() as Promise<T>
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(res.status).toBe(200)
  return res.json() as Promise<T>
}

async function send(...actions: SyncAction[]): Promise<ActionsResponse> {
  return post<ActionsResponse>('/api/sync/actions', { actions })
}

async function cursor(): Promise<number> {
  return (await get<BootstrapResponse>('/api/sync/bootstrap')).cursor
}

async function changesSince(since: number): Promise<Changes> {
  const res = await get<ChangesResponse>(`/api/sync/changes?since=${since}`)
  if (res.reset) throw new Error('Unexpected reset')
  return res
}

function draftInput(overrides: Partial<SyncDraftInput> = {}): SyncDraftInput {
  return {
    id: randomUUID(),
    threadId: null,
    senderId: meContactId(),
    subject: 'Hello',
    contentText: 'Hi there',
    contentHtml: null,
    inReplyTo: null,
    forwardedMessageId: null,
    references: [],
    recipients: [{ email: 'bob@example.com', name: 'Bob', role: 'to' }],
    ...overrides,
  }
}

beforeAll(() => {
  setupDatabase()
})

// The database is a throwaway, but uploads are written to the real uploads directory
afterAll(() => {
  const files = sqlite.prepare('SELECT file_path AS filePath FROM attachments UNION SELECT file_path FROM draft_attachments')
    .all() as { filePath: string }[]
  for (const file of files) {
    rmSync(resolveAttachmentPath(file.filePath), { force: true })
  }
})

describe('import', () => {
  it('keeps the delivery time rather than stamping the import time', async () => {
    const receivedAt = daysAgo(400)
    const { id } = await receive({ sentAt: daysAgo(401), receivedAt })
    const row = sqlite.prepare('SELECT received_at AS receivedAt FROM emails WHERE id = ?').get(id) as { receivedAt: number }
    expect(row.receivedAt).toBe(Math.floor(receivedAt.getTime() / 1000))
  })

  it('falls back to the sent date when there is no delivery time', async () => {
    const sentAt = daysAgo(200)
    const { id } = await receive({ sentAt, receivedAt: undefined })
    const row = sqlite.prepare('SELECT received_at AS receivedAt FROM emails WHERE id = ?').get(id) as { receivedAt: number }
    expect(row.receivedAt).toBe(Math.floor(sentAt.getTime() / 1000))
  })
})

describe('bootstrap', () => {
  it('lists recent threads and pinned old ones, but not other old mail', async () => {
    const recent = await receive()
    const old = await receive({ sentAt: daysAgo(90), receivedAt: daysAgo(90) })
    const oldPinned = await receive({ sentAt: daysAgo(90), receivedAt: daysAgo(90) })
    await send(action('thread.setAside', { threadId: oldPinned.threadId, value: true }))

    const boot = await get<BootstrapResponse>('/api/sync/bootstrap')

    expect(boot.threadIds).toContain(recent.threadId)
    expect(boot.threadIds).toContain(oldPinned.threadId)
    expect(boot.threadIds).not.toContain(old.threadId)
    expect(boot.folders.map(f => f.name)).toEqual(['Inbox', 'Junk', 'Trash'])
    expect(boot.contacts.some(c => c.isMe)).toBe(true)
    expect(boot.config.windowDays).toBe(30)
  })

  it('leaves out folders that are not synced offline', async () => {
    const junk = await receive({ isJunk: true })
    const boot = await get<BootstrapResponse>('/api/sync/bootstrap')
    expect(boot.threadIds).not.toContain(junk.threadId)
  })

  it('counts unread threads per folder', async () => {
    const before = (await get<BootstrapResponse>('/api/sync/bootstrap')).counts.folders[1] ?? 0
    const first = await receive()
    await receive({ inReplyTo: `<in-reply-${first.id}@example.com>`, references: [], subject: 'Unrelated subject' })
    const after = (await get<BootstrapResponse>('/api/sync/bootstrap')).counts.folders[1] ?? 0
    expect(after).toBe(before + 2)
  })
})

describe('threads', () => {
  it('returns whole threads with participants, and reports missing IDs', async () => {
    const first = await receive({ messageId: '<thread-a-1@example.com>', subject: 'Plans' })
    const second = await receive({
      messageId: '<thread-a-2@example.com>',
      subject: 'Re: Plans',
      inReplyTo: '<thread-a-1@example.com>',
      references: ['<thread-a-1@example.com>'],
      headers: [{ key: 'reply-to', value: 'Reply-To: Alice Reply <reply@example.com>' }],
    })
    expect(second.threadId).toBe(first.threadId)

    const res = await post<ThreadsResponse>('/api/sync/threads', { ids: [first.threadId, 999999] })

    expect(res.missing).toEqual([999999])
    expect(res.threads).toHaveLength(1)
    expect(res.threads[0]!.subject).toBe('Plans')
    expect(res.emails.map(e => e.id).sort()).toEqual([first.id, second.id].sort())

    const email = res.emails.find(e => e.id === second.id)!
    expect(email.sender?.email).toBe('alice@example.com')
    expect(email.recipients.map(r => r.email)).toEqual(['me@example.com'])
    expect(email.recipients[0]!.isMe).toBe(true)
    expect(email.replyTo).toBe('Alice Reply <reply@example.com>')
    expect(email.folderId).toBe(1)
    expect(res.threads[0]!.latestAt).toBe(Math.max(...res.emails.map(e => e.date)))
  })
})

describe('changes', () => {
  it('returns nothing when nothing changed', async () => {
    const since = await cursor()
    const res = await changesSince(since)
    expect(res.cursor).toBe(since)
    expect(res.hasMore).toBe(false)
    expect(res.emails).toEqual([])
    expect(res.threads).toEqual([])
    expect(res.deleted).toEqual([])
    expect(res.counts).toBeDefined()
  })

  it('delivers new mail in full', async () => {
    const since = await cursor()
    const { id, threadId } = await receive({ subject: 'Fresh' })

    const res = await changesSince(since)

    expect(res.emails.map(e => e.id)).toEqual([id])
    expect(res.emails[0]!.contentText).toContain('Body')
    expect(res.threads.map(t => t.id)).toEqual([threadId])
    expect(res.emailRefs).toEqual([])
    expect(res.cursor).toBeGreaterThan(since)
  })

  it('only references old mail instead of pushing it', async () => {
    const since = await cursor()
    const { id, threadId } = await receive({ sentAt: daysAgo(120), receivedAt: daysAgo(120) })

    const res = await changesSince(since)

    expect(res.emails).toEqual([])
    expect(res.emailRefs).toEqual([{ id, threadId }])
  })

  it('sends read-state changes without the email body', async () => {
    const { id, threadId } = await receive()
    const since = await cursor()
    await send(action('emails.markRead', { emailIds: [id] }))

    const res = await changesSince(since)

    expect(res.emails).toEqual([])
    expect(res.emailMeta).toHaveLength(1)
    expect(res.emailMeta[0]).toMatchObject({ id, threadId })
    expect(res.emailMeta[0]!.readAt).toBeTypeOf('number')
  })

  it('reports deletions', async () => {
    const { id, threadId } = await receive()
    const since = await cursor()
    await send(action('thread.delete', { threadId }))

    const res = await changesSince(since)

    expect(res.deleted).toContainEqual({ entity: 'emails', id: String(id) })
    expect(res.deleted).toContainEqual({ entity: 'email_threads', id: String(threadId) })
  })

  it('pages through a large set of changes without dropping or repeating any', async () => {
    const since = await cursor()
    const ids: number[] = []
    for (let i = 0; i < 12; i++) {
      ids.push((await receive()).id)
    }

    const seen: number[] = []
    let from = since
    let pages = 0
    for (;;) {
      const page = changesPage(from, 5)
      if (page.reset) throw new Error('Unexpected reset')
      seen.push(...page.emails.map(e => e.id))
      from = page.cursor
      pages++
      if (!page.hasMore) break
    }

    expect(pages).toBeGreaterThan(1)
    expect(seen.sort((a, b) => a - b)).toEqual(ids)
    expect(from).toBe(await cursor())
  })

  it('asks the client to start over when its cursor predates pruned deletions', async () => {
    const { threadId } = await receive()
    const since = await cursor()
    await send(action('thread.delete', { threadId }))
    sqlite.prepare('UPDATE tombstones SET created_at = 0').run()

    const result = cleanupSyncData()
    expect(result.tombstones).toBeGreaterThan(0)

    expect(await get<ChangesResponse>(`/api/sync/changes?since=${since}`)).toEqual({ reset: true })
    // A cursor taken after the pruning is unaffected
    const fresh = await cursor()
    expect((await changesSince(fresh)).cursor).toBe(fresh)
  })

  it('asks the client to start over when its cursor is ahead of the server', async () => {
    const ahead = (await cursor()) + 1000
    expect(await get<ChangesResponse>(`/api/sync/changes?since=${ahead}`)).toEqual({ reset: true })
  })
})

describe('folder paging', () => {
  it('pages backwards through a folder by date', async () => {
    const custom = sqlite.prepare("INSERT INTO folders (name, position, created_at) VALUES ('Archive', 9, 0) RETURNING id").get() as { id: number }
    const threadIds: number[] = []
    for (let i = 0; i < 5; i++) {
      const { threadId } = await receive({ sentAt: daysAgo(100 + i), receivedAt: daysAgo(100 + i) })
      await send(action('thread.move', { threadId, folderId: custom.id }))
      threadIds.push(threadId)
    }

    const first = await get<FolderPageResponse>(`/api/sync/folder-threads?folderId=${custom.id}&limit=2`)
    expect(first.threads.map(t => t.id).sort()).toEqual(threadIds.slice(0, 2).sort())
    expect(first.emails).toHaveLength(2)
    expect(first.hasMore).toBe(true)

    const second = await get<FolderPageResponse>(`/api/sync/folder-threads?folderId=${custom.id}&limit=10&before=${first.nextBefore}`)
    expect(second.threads.map(t => t.id).sort()).toEqual(threadIds.slice(2).sort())
    expect(second.hasMore).toBe(false)
  })
})

describe('actions', () => {
  it('applies an action once, however often it is sent', async () => {
    const { threadId } = await receive()
    const setAside = action('thread.setAside', { threadId, value: true })

    const first = await send(setAside)
    const since = await cursor()
    const second = await send(setAside)

    expect(first.results).toEqual([{ id: setAside.id, ok: true }])
    expect(second.results).toEqual([{ id: setAside.id, ok: true }])
    expect((await changesSince(since)).threads).toEqual([])
  })

  it('rejects actions on things that no longer exist, and carries on with the rest', async () => {
    const { threadId } = await receive()
    const res = await send(
      action('thread.replyLater', { threadId: 999999, value: true }),
      action('thread.replyLater', { threadId, value: true }),
    )

    expect(res.results[0]).toMatchObject({ ok: false, error: 'Thread not found' })
    expect(res.results[0]!.retry).toBeUndefined()
    expect(res.results[1]).toMatchObject({ ok: true })
  })

  it('trashes and restores a thread to where it came from', async () => {
    const { threadId } = await receive({ isJunk: true })

    await send(action('thread.trash', { threadId }))
    let thread = (await post<ThreadsResponse>('/api/sync/threads', { ids: [threadId] })).threads[0]!
    expect(thread).toMatchObject({ folderId: 3, previousFolderId: 2 })
    expect(thread.trashedAt).toBeTypeOf('number')

    await send(action('thread.restore', { threadId }))
    thread = (await post<ThreadsResponse>('/api/sync/threads', { ids: [threadId] })).threads[0]!
    expect(thread).toMatchObject({ folderId: 2, previousFolderId: null, trashedAt: null })
  })

  it('marks a whole folder read', async () => {
    await receive()
    await send(action('folder.markAllRead', { folderId: 1 }))
    expect((await get<BootstrapResponse>('/api/sync/bootstrap')).counts.folders[1]).toBeUndefined()
  })

  it('deleting the last email removes the thread', async () => {
    const { id, threadId } = await receive()
    await send(action('email.delete', { emailId: id }))
    expect((await post<ThreadsResponse>('/api/sync/threads', { ids: [threadId] })).missing).toEqual([threadId])
  })
})

describe('drafts', () => {
  it('saves, updates and deletes a draft', async () => {
    const draft = draftInput()
    const since = await cursor()

    await send(action('draft.save', { draft }))
    await send(action('draft.save', { draft: { ...draft, subject: 'Hello again' } }))

    let res = await changesSince(since)
    expect(res.drafts).toHaveLength(1)
    expect(res.drafts[0]).toMatchObject({ id: draft.id, subject: 'Hello again', attachments: [] })
    expect(res.drafts[0]!.recipients).toEqual([{ email: 'bob@example.com', name: 'Bob', role: 'to' }])

    await send(action('draft.delete', { draftId: draft.id }))
    res = await changesSince(res.cursor)
    expect(res.deleted).toEqual([{ entity: 'drafts', id: draft.id }])
  })

  it('stores an uploaded attachment once and serves it back', async () => {
    const draft = draftInput()
    await send(action('draft.save', { draft }))
    const attachmentId = randomUUID()

    const upload = async () => {
      const form = new FormData()
      form.append('file', new File(['hello world'], 'note.txt', { type: 'text/plain' }))
      form.append('draftId', draft.id)
      return app.request(`/api/draft-attachments/${attachmentId}`, { method: 'PUT', body: form })
    }

    const since = await cursor()
    expect((await upload()).status).toBe(200)
    expect((await upload()).status).toBe(200)

    const rows = sqlite.prepare('SELECT id FROM draft_attachments WHERE draft_id = ?').all(draft.id)
    expect(rows).toHaveLength(1)

    const file = await app.request(`/api/draft-attachments/${attachmentId}`)
    expect(await file.text()).toBe('hello world')

    // The draft is re-sent to clients with its attachment
    const res = await changesSince(since)
    expect(res.drafts[0]!.attachments).toEqual([
      { id: attachmentId, filename: 'note.txt', mimeType: expect.stringContaining('text/plain'), size: 11, isInline: false },
    ])

    await send(action('draft.removeAttachment', { draftId: draft.id, attachmentId }))
    expect((await app.request(`/api/draft-attachments/${attachmentId}`)).status).toBe(404)
  })

  it('sends a new message: creates a thread and a queued email, and removes the draft', async () => {
    const draft = draftInput({ subject: 'New conversation' })
    const messageId = `<${randomUUID()}@example.com>`
    const since = await cursor()

    const res = await send(action('draft.send', { draft, messageId }))
    expect(res.results[0]!.ok).toBe(true)

    const feed = await changesSince(since)
    expect(feed.deleted).toContainEqual({ entity: 'drafts', id: draft.id })
    expect(feed.emails).toHaveLength(1)

    const email = feed.emails[0]!
    expect(email).toMatchObject({ status: 'queued', messageId, subject: 'New conversation', folderId: 1 })
    expect(email.sender?.isMe).toBe(true)
    expect(email.recipients.map(r => r.email)).toEqual(['bob@example.com'])
    expect(email.readAt).not.toBeNull()
    expect(feed.threads.find(t => t.id === email.threadId)?.subject).toBe('New conversation')
    // The new recipient became a contact
    expect(feed.contacts.map(c => c.email)).toContain('bob@example.com')
  })

  it('sends a reply into its thread and takes the thread out of Reply Later', async () => {
    const original = await receive({ messageId: '<to-reply@example.com>' })
    await send(action('thread.replyLater', { threadId: original.threadId, value: true }))

    const draft = draftInput({
      threadId: original.threadId,
      inReplyTo: '<to-reply@example.com>',
      references: ['<to-reply@example.com>'],
      recipients: [{ email: 'alice@example.com', name: 'Alice', role: 'to' }],
    })
    await send(action('draft.send', { draft, messageId: `<${randomUUID()}@example.com>` }))

    const res = await post<ThreadsResponse>('/api/sync/threads', { ids: [original.threadId] })
    expect(res.emails).toHaveLength(2)
    expect(res.threads[0]!.replyLaterAt).toBeNull()
  })

  it('turns inline images into cid attachments on send', async () => {
    const draft = draftInput()
    await send(action('draft.save', { draft }))
    const attachmentId = randomUUID()
    const form = new FormData()
    form.append('file', new File(['png'], 'pic.png', { type: 'image/png' }))
    form.append('draftId', draft.id)
    form.append('isInline', 'true')
    await app.request(`/api/draft-attachments/${attachmentId}`, { method: 'PUT', body: form })

    const since = await cursor()
    await send(action('draft.send', {
      draft: { ...draft, contentHtml: `<p>Look</p><img src="/api/draft-attachments/${attachmentId}">` },
      messageId: `<${randomUUID()}@example.com>`,
    }))

    const email = (await changesSince(since)).emails[0]!
    expect(email.contentHtml).toBe(`<p>Look</p><img src="cid:${attachmentId}@meremail">`)
    expect(email.attachments).toEqual([
      expect.objectContaining({ filename: 'pic.png', isInline: true, contentId: `${attachmentId}@meremail` }),
    ])
  })

  it('refuses to send without recipients, and keeps the draft', async () => {
    const draft = draftInput({ recipients: [] })
    await send(action('draft.save', { draft }))
    const res = await send(action('draft.send', { draft, messageId: `<${randomUUID()}@example.com>` }))

    expect(res.results[0]).toMatchObject({ ok: false, error: 'No recipients specified' })
    expect(sqlite.prepare('SELECT id FROM drafts WHERE id = ?').get(draft.id)).toBeDefined()
  })
})
