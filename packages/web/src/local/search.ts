import { INBOX_FOLDER_ID } from '@meremail/shared/sync-types'
import {
  parseQuery,
  matchesText,
  dateRange,
  searchSnippet,
  type SearchQuery,
  type SearchDocument,
  type EmailSearchHit,
} from '@meremail/shared/search'
import { db, type LocalEmail, type LocalDraft, type LocalContact } from './db'
import { makeSnippet } from './store'
import { ensureThreads } from './sync'

/**
 * Two-tier search: what's on this device answers immediately, and the server
 * is asked for the rest of the archive. Threads the server turns up are
 * stored locally, like anything else the user goes looking for.
 *
 * Both tiers read the query the same way (see @meremail/shared/search), and
 * both give one result per thread.
 */

export interface EmailSearchFilters {
  /** In the search query language, e.g. `from:alice invoice` */
  query: string
  unreadOnly: boolean
}

export type EmailSearchResult = EmailSearchHit

/** What identifies a result: its thread, or the draft if it has no thread */
export function resultKey(result: EmailSearchResult): string {
  return result.threadId !== null ? `thread:${result.threadId}` : `draft:${result.draftId}`
}

function people(list: { name: string | null; email: string }[]): string {
  return list.map(person => `${person.name ?? ''} ${person.email}`).join('\n')
}

export function emailDocument(email: LocalEmail): SearchDocument {
  return {
    subject: email.subject,
    body: email.contentText,
    sender: email.sender ? people([email.sender]) : '',
    recipients: people(email.recipients),
    filenames: email.attachments.filter(a => !a.isInline).map(a => a.filename).join('\n'),
  }
}

export function draftDocument(draft: LocalDraft, sender: LocalContact | undefined): SearchDocument {
  return {
    subject: draft.subject,
    body: draft.contentText,
    sender: sender ? people([sender]) : '',
    recipients: people(draft.recipients),
    filenames: draft.attachments.filter(a => !a.isInline).map(a => a.filename).join('\n'),
  }
}

function emailResult(email: LocalEmail, query: SearchQuery): EmailSearchResult {
  return {
    emailId: email.id,
    threadId: email.threadId,
    draftId: null,
    subject: email.subject,
    snippet: searchSnippet(email.contentText || makeSnippet(email), query),
    senderName: email.sender?.name ?? null,
    senderEmail: email.sender?.email ?? '',
    date: email.sentAt ?? email.date,
    isRead: !email.unread,
    matches: 1,
  }
}

function draftResult(draft: LocalDraft, sender: LocalContact | undefined, query: SearchQuery): EmailSearchResult {
  return {
    emailId: null,
    threadId: draft.threadId,
    draftId: draft.id,
    subject: draft.subject || '(No subject)',
    snippet: searchSnippet(draft.contentText, query),
    senderName: sender?.name ?? null,
    senderEmail: sender?.email ?? '',
    date: draft.updatedAt,
    isRead: true,
    matches: 1,
  }
}

/**
 * One result per thread: its newest match, or its oldest when sorting oldest
 * first. Used for what one tier finds (counting matches) and for combining
 * the two tiers (which may each have counted the same messages).
 */
function groupByThread(results: EmailSearchResult[], sort: SearchQuery['sort'], count: 'sum' | 'max'): EmailSearchResult[] {
  const before = (a: EmailSearchResult, b: EmailSearchResult) => sort === 'oldest' ? a.date < b.date : a.date > b.date
  const groups = new Map<string, EmailSearchResult>()
  for (const result of results) {
    const key = resultKey(result)
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, result)
    } else {
      const matches = count === 'sum' ? existing.matches + result.matches : Math.max(existing.matches, result.matches)
      groups.set(key, { ...(before(result, existing) ? result : existing), matches })
    }
  }
  return [...groups.values()].sort((a, b) => sort === 'oldest' ? a.date - b.date : b.date - a.date)
}

/**
 * Search the emails and drafts held on this device
 */
export async function searchLocal(filters: EmailSearchFilters): Promise<EmailSearchResult[]> {
  const query = parseQuery(filters.query)
  const unread = filters.unreadOnly ? true : query.unread
  const { from, to } = dateRange(query)
  const inRange = (date: number) => (from === null || date >= from) && (to === null || date <= to)

  let folderIds: Set<number> | null = null
  let allowedThreads: Set<number> | null = null
  if (query.folders.length > 0) {
    const folders = await db.folders.filter(f => query.folders.includes(f.name.toLowerCase())).toArray()
    folderIds = new Set(folders.map(f => f.id))
    allowedThreads = new Set(await db.threads.where('folderId').anyOf([...folderIds]).primaryKeys())
  }

  const emails = await db.emails
    .filter((email) => {
      if (allowedThreads && !allowedThreads.has(email.threadId)) return false
      if (unread !== null && !!email.unread !== unread) return false
      if (query.hasAttachment && !email.attachments.some(a => !a.isInline)) return false
      if (!inRange(email.sentAt ?? email.date)) return false
      return matchesText(emailDocument(email), query)
    })
    .toArray()

  const results = emails.map(email => emailResult(email, query))

  // Drafts only exist as drafts here and on the server's drafts table, which
  // the server search doesn't cover - so this is the only place they're found.
  // A draft counts as read, and one without a thread shows in the Inbox.
  if (unread !== true) {
    const drafts = await db.drafts.toArray()
    const senders = new Map((await db.contacts.bulkGet(drafts.map(d => d.senderId))).map((c, i) => [drafts[i]!.id, c]))
    for (const draft of drafts) {
      if (draft.threadId !== null ? allowedThreads && !allowedThreads.has(draft.threadId) : folderIds && !folderIds.has(INBOX_FOLDER_ID)) continue
      if (query.hasAttachment && !draft.attachments.some(a => !a.isInline)) continue
      if (!inRange(draft.updatedAt)) continue
      const sender = senders.get(draft.id)
      if (matchesText(draftDocument(draft, sender), query)) results.push(draftResult(draft, sender, query))
    }
  }

  return groupByThread(results, query.sort, 'sum')
}

interface ServerSearchResponse {
  results: (EmailSearchHit & { type: string })[]
  hasMore: boolean
}

/**
 * Search the whole archive on the server, and keep the threads it finds
 */
export async function searchServer(
  filters: EmailSearchFilters,
  offset: number,
  limit = 25
): Promise<{ results: EmailSearchResult[]; hasMore: boolean }> {
  const params = new URLSearchParams({
    type: 'email',
    q: filters.query,
    limit: String(limit),
    offset: String(offset),
  })
  if (filters.unreadOnly) params.set('unreadOnly', 'true')
  // Days in the query are this device's days, not the server's
  const { from, to } = dateRange(parseQuery(filters.query))
  if (from !== null) params.set('from', String(from))
  if (to !== null) params.set('to', String(to))

  const response = await fetch(`/api/search?${params}`)
  if (!response.ok) throw new Error(`Search failed (${response.status})`)
  const data = await response.json() as ServerSearchResponse

  const results = data.results
    .filter(r => r.type === 'email')
    .map(({ type: _type, ...result }) => result)

  // Keep whatever turned up, so it opens instantly and works offline
  await ensureThreads([...new Set(results.map(r => r.threadId).filter((id): id is number => id !== null))])

  return { results, hasMore: data.hasMore }
}

/**
 * Combine local and server results into one list with one entry per thread,
 * in the order the query asks for.
 */
export function mergeResults(local: EmailSearchResult[], server: EmailSearchResult[], sort: SearchQuery['sort']): EmailSearchResult[] {
  return groupByThread([...server, ...local], sort, 'max')
}

/**
 * The most recent search and what it found. Coming back to the same search
 * (opening a result, then Back) shows exactly the same list straight away,
 * rather than re-running it and having results shift as the server answers.
 */
export const lastSearch: {
  key: string
  local: EmailSearchResult[]
  server: EmailSearchResult[]
  hasMore: boolean
} = { key: '', local: [], server: [], hasMore: false }

/**
 * Bring remembered results up to date with what has been read since
 */
export async function refreshReadState(results: EmailSearchResult[]): Promise<EmailSearchResult[]> {
  const emails = await db.emails.bulkGet(results.map(r => r.emailId ?? -1))
  return results.map((result, i) => {
    const email = emails[i]
    return email ? { ...result, isRead: !email.unread } : result
  })
}
