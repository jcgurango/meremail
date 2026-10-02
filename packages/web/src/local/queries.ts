import Dexie from 'dexie'
import { INBOX_FOLDER_ID } from '@meremail/shared/sync-types'
import { db, getMeta, type LocalThread, type LocalEmail, type LocalDraft, type LocalFolder, type LocalContact } from './db'
import { displayedUnreadCount, localUnreadByFolder, getWatermark } from './store'

/**
 * Read-side helpers: the shapes the UI wants, built from the local database.
 */

export interface ThreadListItem {
  type: 'thread' | 'draft'
  /** Thread ID, or draft ID for a draft that isn't part of a thread yet */
  id: number | string
  subject: string
  latestAt: number | null
  unreadCount: number
  totalCount: number
  draftCount: number
  queuedCount: number
  participants: { name: string | null; email: string }[]
  snippet: string
}

async function draftCountsByThread(): Promise<Map<number, number>> {
  const counts = new Map<number, number>()
  await db.drafts.each((draft) => {
    if (draft.threadId !== null) {
      counts.set(draft.threadId, (counts.get(draft.threadId) || 0) + 1)
    }
  })
  return counts
}

function toListItem(thread: LocalThread, draftCounts: Map<number, number>): ThreadListItem {
  return {
    type: 'thread',
    id: thread.id,
    subject: thread.subject,
    latestAt: thread.latestAt,
    unreadCount: thread.unreadCount,
    totalCount: thread.totalCount,
    draftCount: draftCounts.get(thread.id) || 0,
    queuedCount: thread.queuedCount,
    participants: thread.participants,
    snippet: thread.snippet,
  }
}

function draftToListItem(draft: LocalDraft): ThreadListItem {
  return {
    type: 'draft',
    id: draft.id,
    subject: draft.subject || '(No subject)',
    latestAt: draft.updatedAt,
    unreadCount: 0,
    totalCount: 1,
    draftCount: draft.sending ? 0 : 1,
    queuedCount: draft.sending ? 1 : 0,
    participants: draft.recipients.map(r => ({ name: r.name, email: r.email })),
    snippet: draft.contentText.substring(0, 150),
  }
}

/**
 * Threads in a folder, newest first.
 *
 * `from` is the date the list goes back to. By default that's the folder's
 * watermark - the point back to which the local copy is known to be complete -
 * so the list never has gaps.
 */
export async function listFolderThreads(
  folderId: number,
  options: { from?: number; unreadOnly?: boolean } = {}
): Promise<ThreadListItem[]> {
  const from = options.from ?? await getWatermark(folderId)
  if (from === Infinity) return []

  const threads = await db.threads
    .where('[folderId+latestAt]')
    .between([folderId, from], [folderId, Dexie.maxKey], true, true)
    .reverse()
    .toArray()

  const draftCounts = await draftCountsByThread()
  const items = threads
    .filter(t => !options.unreadOnly || t.unreadCount > 0)
    .map(t => toListItem(t, draftCounts))

  // New messages that haven't been sent yet have no thread; show them at the top of the Inbox
  if (folderId === INBOX_FOLDER_ID && !options.unreadOnly) {
    const standalone = (await db.drafts.toArray())
      .filter(d => d.threadId === null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return [...standalone.map(draftToListItem), ...items]
  }

  return items
}

/**
 * The Reply Later queue: threads flagged for it, plus any thread with an
 * unsent draft. Oldest first, so nothing gets buried.
 */
export async function listReplyLater(): Promise<ThreadListItem[]> {
  const draftCounts = await draftCountsByThread()
  const flagged = await db.threads.where('replyLaterAt').above(0).toArray()
  const flaggedIds = new Set(flagged.map(t => t.id))
  const withDrafts = (await db.threads.bulkGet([...draftCounts.keys()].filter(id => !flaggedIds.has(id))))
    .filter((t): t is LocalThread => !!t)

  return [...flagged, ...withDrafts]
    .sort((a, b) => (a.replyLaterAt ?? a.latestAt ?? 0) - (b.replyLaterAt ?? b.latestAt ?? 0))
    .map(t => toListItem(t, draftCounts))
}

/**
 * Every email from threads that have been set aside, newest first
 */
export async function listSetAsideEmails(): Promise<LocalEmail[]> {
  const threadIds = await db.threads.where('setAsideAt').above(0).primaryKeys()
  const emails = await db.emails.where('threadId').anyOf(threadIds).toArray()
  return emails.sort((a, b) => (b.sentAt ?? b.date) - (a.sentAt ?? a.date))
}

export interface ThreadView {
  thread: LocalThread
  emails: LocalEmail[]
  drafts: LocalDraft[]
}

export async function getThreadView(threadId: number): Promise<ThreadView | null> {
  const thread = await db.threads.get(threadId)
  if (!thread) return null

  return {
    thread,
    emails: await db.emails.where('threadId').equals(threadId).toArray(),
    drafts: await db.drafts.where('threadId').equals(threadId).toArray(),
  }
}

export interface FolderNavItem extends LocalFolder {
  unreadCount: number
}

export interface Navigation {
  folders: FolderNavItem[]
  replyLaterCount: number
  setAsideCount: number
}

export async function getNavigation(): Promise<Navigation> {
  const folders = await db.folders.orderBy('position').toArray()
  const serverCounts = await getMeta('counts')
  const baseline = await getMeta('countsBaseline')
  const local = await localUnreadByFolder()

  return {
    folders: folders.map(f => ({
      ...f,
      unreadCount: displayedUnreadCount(f.id, serverCounts, baseline, local),
    })),
    replyLaterCount: (await listReplyLater()).length,
    setAsideCount: await db.threads.where('setAsideAt').above(0).count(),
  }
}

/**
 * The user's own addresses, default identity first
 */
export async function listIdentities(): Promise<LocalContact[]> {
  const identities = await db.contacts.filter(c => c.isMe).toArray()
  return identities.sort((a, b) =>
    Number(b.isDefaultIdentity) - Number(a.isDefaultIdentity) || a.email.localeCompare(b.email)
  )
}

export async function searchContacts(query: string, limit = 10): Promise<LocalContact[]> {
  const term = query.toLowerCase().trim()
  if (term.length < 2) return []

  return db.contacts
    .filter(c => c.email.toLowerCase().includes(term) || (c.name?.toLowerCase().includes(term) ?? false))
    .limit(limit)
    .toArray()
}

/**
 * Which of my addresses to reply from: the one the thread was most recently
 * sent from or to.
 */
export function defaultFromId(emails: LocalEmail[]): number | null {
  const newestFirst = [...emails].sort((a, b) => b.date - a.date)
  for (const email of newestFirst) {
    if (email.sender?.isMe) return email.sender.id
    const me = email.recipients.find(r => r.isMe)
    if (me) return me.id
  }
  return null
}
