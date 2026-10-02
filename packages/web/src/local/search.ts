import { db, type LocalEmail } from './db'
import { makeSnippet } from './store'
import { ensureThreads } from './sync'

/**
 * Two-tier search: what's on this device answers immediately, and the server
 * is asked for the rest of the archive. Threads the server turns up are
 * stored locally, like anything else the user goes looking for.
 */

export interface EmailSearchFilters {
  query: string
  senderId: number | null
  /** yyyy-mm-dd */
  dateFrom: string
  /** yyyy-mm-dd */
  dateTo: string
  sortBy: 'relevance' | 'date'
  /** Empty means all folders */
  folderIds: number[]
  unreadOnly: boolean
}

export interface EmailSearchResult {
  id: number
  threadId: number
  subject: string
  snippet: string
  senderName: string | null
  senderEmail: string
  sentAt: number | null
  isRead: boolean
}

function toResult(email: LocalEmail): EmailSearchResult {
  return {
    id: email.id,
    threadId: email.threadId,
    subject: email.subject,
    snippet: makeSnippet(email).replace(/\s+/g, ' ').trim(),
    senderName: email.sender?.name ?? null,
    senderEmail: email.sender?.email ?? '',
    sentAt: email.sentAt ?? email.date,
    isRead: !email.unread,
  }
}

export function matchesQuery(email: Pick<LocalEmail, 'subject' | 'contentText' | 'sender'>, tokens: string[]): boolean {
  if (tokens.length === 0) return true
  const haystack = `${email.subject}\n${email.contentText}\n${email.sender?.name ?? ''}\n${email.sender?.email ?? ''}`.toLowerCase()
  return tokens.every(token => haystack.includes(token))
}

export function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

/**
 * Search the emails held on this device
 */
export async function searchLocal(filters: EmailSearchFilters): Promise<EmailSearchResult[]> {
  const tokens = filters.query.trim().length >= 2 ? tokenize(filters.query) : []
  const from = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`).getTime() : null
  const to = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59`).getTime() : null

  let allowedThreads: Set<number> | null = null
  if (filters.folderIds.length > 0) {
    allowedThreads = new Set(await db.threads.where('folderId').anyOf(filters.folderIds).primaryKeys())
  }

  const matches = await db.emails
    .filter((email) => {
      if (allowedThreads && !allowedThreads.has(email.threadId)) return false
      if (filters.senderId && email.sender?.id !== filters.senderId) return false
      if (filters.unreadOnly && !email.unread) return false
      const sentAt = email.sentAt ?? email.date
      if (from !== null && sentAt < from) return false
      if (to !== null && sentAt > to) return false
      return matchesQuery(email, tokens)
    })
    .toArray()

  return matches
    .sort((a, b) => (b.sentAt ?? b.date) - (a.sentAt ?? a.date))
    .map(toResult)
}

interface ServerSearchResponse {
  results: {
    type: string
    id: number
    threadId: number
    subject: string
    snippet: string
    senderName: string | null
    senderEmail: string
    sentAt: string | null
    isRead: boolean
  }[]
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
  const params = new URLSearchParams({ type: 'email', limit: String(limit), offset: String(offset) })
  if (filters.folderIds.length > 0) params.set('folderIds', filters.folderIds.join(','))
  if (filters.query) params.set('q', filters.query)
  if (filters.senderId) params.set('senderId', String(filters.senderId))
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) params.set('dateTo', filters.dateTo)
  if (filters.unreadOnly) params.set('unreadOnly', 'true')
  if (filters.sortBy) params.set('sortBy', filters.sortBy)

  const response = await fetch(`/api/search?${params}`)
  if (!response.ok) throw new Error(`Search failed (${response.status})`)
  const data = await response.json() as ServerSearchResponse

  const results = data.results
    .filter(r => r.type === 'email')
    .map(r => ({
      id: r.id,
      threadId: r.threadId,
      subject: r.subject,
      snippet: r.snippet,
      senderName: r.senderName,
      senderEmail: r.senderEmail,
      sentAt: r.sentAt ? new Date(r.sentAt).getTime() : null,
      isRead: r.isRead,
    }))

  // Keep whatever turned up, so it opens instantly and works offline
  await ensureThreads([...new Set(results.map(r => r.threadId))])

  return { results, hasMore: data.hasMore }
}

/**
 * Combine local and server results: server order first (it ranks by
 * relevance), then anything only found locally.
 */
export function mergeResults(local: EmailSearchResult[], server: EmailSearchResult[]): EmailSearchResult[] {
  const seen = new Set(server.map(r => r.id))
  return [...server, ...local.filter(r => !seen.has(r.id))]
}
