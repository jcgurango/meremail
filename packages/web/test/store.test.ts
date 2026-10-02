import { describe, it, expect, beforeEach } from 'vitest'
import type { ChangesResponse } from '@meremail/shared/sync-types'
import { db, getMeta, setMeta } from '@/local/db'
import {
  storeThreads,
  applyChanges,
  evictExpired,
  setServerCounts,
  getWatermark,
  setWatermark,
  displayedUnreadCount,
  localUnreadByFolder,
} from '@/local/store'
import { listFolderThreads, listReplyLater, getNavigation } from '@/local/queries'
import { resetDb, makeThread, makeEmail, FOLDERS, CONFIG, DAY, ME } from './helpers'

type Page = Exclude<ChangesResponse, { reset: true }>

function page(overrides: Partial<Page> = {}): Page {
  return {
    cursor: 10,
    hasMore: false,
    serverTime: Date.now(),
    config: CONFIG,
    folders: [],
    contacts: [],
    threads: [],
    emails: [],
    emailMeta: [],
    emailRefs: [],
    drafts: [],
    deleted: [],
    ...overrides,
  }
}

beforeEach(async () => {
  await resetDb()
  await db.folders.bulkPut(FOLDERS)
  await setMeta('config', CONFIG)
  await setMeta('floor', Date.now() - 30 * DAY)
})

describe('storeThreads', () => {
  it('derives list fields from the emails', async () => {
    const now = Date.now()
    await storeThreads(
      [makeThread(1)],
      [
        makeEmail(1, { date: now - 2000, contentText: 'first', readAt: now }),
        makeEmail(1, { date: now - 1000, contentText: 'second' }),
      ],
      { touch: true }
    )

    const thread = (await db.threads.get(1))!
    expect(thread.totalCount).toBe(2)
    expect(thread.unreadCount).toBe(1)
    expect(thread.snippet).toBe('second')
    expect(thread.latestAt).toBe(now - 1000)
    expect(thread.participants.map(p => p.email)).toEqual(['alice@example.com'])
  })

  it('drops emails the server no longer has for the thread', async () => {
    const kept = makeEmail(1)
    const gone = makeEmail(1)
    await storeThreads([makeThread(1)], [kept, gone], { touch: true })
    await storeThreads([makeThread(1)], [kept], { touch: false })

    expect(await db.emails.get(gone.id)).toBeUndefined()
    expect((await db.threads.get(1))!.totalCount).toBe(1)
  })

  it('only restarts the retention clock when asked to', async () => {
    await storeThreads([makeThread(1)], [makeEmail(1)], { touch: true })
    await db.threads.update(1, { retrievedAt: 5 })

    await storeThreads([makeThread(1)], [makeEmail(1)], { touch: false })
    expect((await db.threads.get(1))!.retrievedAt).toBe(5)

    await storeThreads([makeThread(1)], [makeEmail(1)], { touch: true })
    expect((await db.threads.get(1))!.retrievedAt).toBeGreaterThan(5)
  })
})

describe('thread lists', () => {
  it('lists a folder newest first, back to its watermark only', async () => {
    const now = Date.now()
    await storeThreads(
      [makeThread(1), makeThread(2), makeThread(3), makeThread(4, { folderId: 2 })],
      [
        makeEmail(1, { date: now - 3 * DAY }),
        makeEmail(2, { date: now - 1 * DAY }),
        // Held (e.g. found by search) but older than the point the local copy is complete to
        makeEmail(3, { date: now - 200 * DAY }),
        makeEmail(4, { date: now }),
      ],
      { touch: true }
    )

    expect((await listFolderThreads(1)).map(t => t.id)).toEqual([2, 1])
    expect((await listFolderThreads(1, { from: 0 })).map(t => t.id)).toEqual([2, 1, 3])
    // Junk doesn't sync offline, so nothing is known to be complete
    expect(await listFolderThreads(2)).toEqual([])
    expect((await listFolderThreads(2, { from: 0 })).map(t => t.id)).toEqual([4])
  })

  it('filters to unread', async () => {
    await storeThreads(
      [makeThread(1), makeThread(2)],
      [makeEmail(1, { readAt: Date.now() }), makeEmail(2)],
      { touch: true }
    )
    expect((await listFolderThreads(1, { unreadOnly: true })).map(t => t.id)).toEqual([2])
  })

  it('puts Reply Later in the order threads were added, including threads with drafts', async () => {
    await storeThreads(
      [makeThread(1, { replyLaterAt: 200 }), makeThread(2, { replyLaterAt: 100 }), makeThread(3)],
      [makeEmail(1), makeEmail(2), makeEmail(3, { date: 150 })],
      { touch: true }
    )
    await db.drafts.put({
      id: 'd1', threadId: 3, senderId: 1, subject: '', contentText: '', contentHtml: null, inReplyTo: null,
      forwardedMessageId: null, references: [], recipients: [], attachments: [], createdAt: 0, updatedAt: 0,
    })

    const queue = await listReplyLater()
    expect(queue.map(t => t.id)).toEqual([2, 3, 1])
    expect(queue.find(t => t.id === 3)!.draftCount).toBe(1)
  })
})

describe('unread counts', () => {
  it('shows the server count, moved by local changes since', async () => {
    // Server says 12 unread threads in the Inbox; only 2 of them are on this device
    await storeThreads([makeThread(1), makeThread(2)], [makeEmail(1), makeEmail(2)], { touch: true })
    await setServerCounts({ folders: { 1: 12 } })

    const inbox = async () => (await getNavigation()).folders.find(f => f.id === 1)!.unreadCount
    expect(await inbox()).toBe(12)

    // Reading one locally brings it down before the server has heard about it
    const email = (await db.emails.where('threadId').equals(1).first())!
    await db.emails.update(email.id, { unread: 0, readAt: Date.now() })
    await db.threads.update(1, { unreadCount: 0 })
    expect(await inbox()).toBe(11)
  })

  it('is not moved by fetching more of what the server already counted', async () => {
    await setServerCounts({ folders: { 1: 12 } })
    await storeThreads([makeThread(1)], [makeEmail(1)], { touch: true })

    expect(displayedUnreadCount(1, await getMeta('counts'), await getMeta('countsBaseline'), await localUnreadByFolder())).toBe(12)
  })
})

describe('applyChanges', () => {
  it('adds new mail to a held thread and restarts its retention clock', async () => {
    await storeThreads([makeThread(1)], [makeEmail(1, { readAt: 1 })], { touch: true })
    await db.threads.update(1, { retrievedAt: 5 })

    const result = await applyChanges(page({ emails: [makeEmail(1, { contentText: 'new one' })] }))

    expect(result).toEqual({ fetch: [], refresh: [] })
    const thread = (await db.threads.get(1))!
    expect(thread.totalCount).toBe(2)
    expect(thread.unreadCount).toBe(1)
    expect(thread.snippet).toBe('new one')
    expect(thread.retrievedAt).toBeGreaterThan(5)
  })

  it('asks for the whole thread when mail arrives for one not held', async () => {
    const result = await applyChanges(page({ emails: [makeEmail(7)] }))
    expect(result.fetch).toEqual([7])
    expect(await db.emails.count()).toBe(0)
  })

  it('ignores mail for folders that are not kept offline', async () => {
    const result = await applyChanges(page({ emails: [makeEmail(7, { folderId: 2 })] }))
    expect(result.fetch).toEqual([])
  })

  it('applies read state without touching retention', async () => {
    const email = makeEmail(1)
    await storeThreads([makeThread(1)], [email], { touch: true })
    await db.threads.update(1, { retrievedAt: 5 })

    await applyChanges(page({ emailMeta: [{ id: email.id, threadId: 1, readAt: 123 }] }))

    const thread = (await db.threads.get(1))!
    expect(thread.unreadCount).toBe(0)
    expect(thread.retrievedAt).toBe(5)
  })

  it('updates held threads and ignores changes to old threads held elsewhere', async () => {
    await storeThreads([makeThread(1)], [makeEmail(1)], { touch: true })

    const result = await applyChanges(page({
      threads: [
        makeThread(1, { folderId: 3, trashedAt: 99 }),
        makeThread(2, { latestAt: Date.now() - 300 * DAY }),
      ],
    }))

    expect(result.fetch).toEqual([])
    expect((await db.threads.get(1))!.folderId).toBe(3)
    expect(await db.threads.get(2)).toBeUndefined()
  })

  it('fetches a thread that moves into the range held locally, or gets pinned', async () => {
    const result = await applyChanges(page({
      threads: [
        makeThread(2, { latestAt: Date.now() - DAY }),
        makeThread(3, { latestAt: Date.now() - 300 * DAY, setAsideAt: 5 }),
      ],
    }))
    expect(result.fetch.sort()).toEqual([2, 3])
  })

  it('refreshes a held thread when one of its old emails changes', async () => {
    await storeThreads([makeThread(1)], [makeEmail(1)], { touch: true })
    const result = await applyChanges(page({ emailRefs: [{ id: 555, threadId: 1 }, { id: 556, threadId: 9 }] }))
    expect(result).toEqual({ fetch: [], refresh: [1] })
  })

  it('removes deleted emails and threads', async () => {
    const a = makeEmail(1)
    const b = makeEmail(1)
    await storeThreads([makeThread(1), makeThread(2)], [a, b, makeEmail(2)], { touch: true })

    await applyChanges(page({
      deleted: [{ entity: 'emails', id: String(a.id) }, { entity: 'email_threads', id: '2' }],
    }))

    expect((await db.threads.get(1))!.totalCount).toBe(1)
    expect(await db.threads.get(2)).toBeUndefined()
    expect(await db.emails.where('threadId').equals(2).count()).toBe(0)
  })
})

describe('retention', () => {
  const longAgo = Date.now() - 31 * DAY

  it('evicts threads 30 days after they were last retrieved, whatever their date', async () => {
    const now = Date.now()
    await storeThreads(
      [makeThread(1), makeThread(2)],
      // Thread 1 is recent mail retrieved long ago; thread 2 is ancient mail retrieved just now
      [makeEmail(1, { date: now - DAY }), makeEmail(2, { date: now - 900 * DAY })],
      { touch: true }
    )
    await db.threads.update(1, { retrievedAt: longAgo })

    expect(await evictExpired()).toBe(1)
    expect(await db.threads.get(1)).toBeUndefined()
    expect(await db.emails.where('threadId').equals(1).count()).toBe(0)
    expect(await db.threads.get(2)).toBeDefined()
  })

  it('keeps threads that are set aside, in reply later, or have a draft or a queued action', async () => {
    await storeThreads(
      [makeThread(1, { setAsideAt: 1 }), makeThread(2, { replyLaterAt: 1 }), makeThread(3), makeThread(4), makeThread(5)],
      [makeEmail(1), makeEmail(2), makeEmail(3), makeEmail(4), makeEmail(5)],
      { touch: true }
    )
    await db.threads.toCollection().modify({ retrievedAt: longAgo })
    await db.drafts.put({
      id: 'd1', threadId: 3, senderId: ME.id, subject: '', contentText: '', contentHtml: null, inReplyTo: null,
      forwardedMessageId: null, references: [], recipients: [], attachments: [], createdAt: 0, updatedAt: 0,
    })
    await db.actions.add({ id: 'a1', type: 'thread.trash', payload: { threadId: 4 }, createdAt: 0, attempts: 0 })

    expect(await evictExpired()).toBe(1)
    expect((await db.threads.toCollection().primaryKeys()).sort()).toEqual([1, 2, 3, 4])
  })

  it('moves the folder watermark forward so the list has no gap', async () => {
    const now = Date.now()
    await storeThreads(
      [makeThread(1), makeThread(2), makeThread(3)],
      [makeEmail(1, { date: now - 20 * DAY }), makeEmail(2, { date: now - 10 * DAY }), makeEmail(3, { date: now - 5 * DAY })],
      { touch: true }
    )
    // Thread 2 was retrieved long ago; thread 1 (older mail) was re-retrieved recently
    await db.threads.update(2, { retrievedAt: longAgo })

    await evictExpired()

    expect(await getWatermark(1)).toBe(now - 10 * DAY + 1)
    // Thread 1 is still held, but sits behind the gap, so the list stops before it
    expect((await listFolderThreads(1)).map(t => t.id)).toEqual([3])
    expect(await db.threads.get(1)).toBeDefined()
  })

  it('leaves the watermark alone when evicting mail older than it', async () => {
    await setWatermark(1, 500)
    await storeThreads([makeThread(1)], [makeEmail(1, { date: 100 })], { touch: true })
    await db.threads.update(1, { retrievedAt: longAgo })

    await evictExpired()
    expect(await getWatermark(1)).toBe(500)
  })
})
