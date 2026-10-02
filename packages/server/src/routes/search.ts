import { Hono } from 'hono'
import { sqlite, parseQuery, toFtsMatch, hasCriteria, dateRange, searchSnippet } from '@meremail/shared'
import type { SearchQuery, EmailSearchHit } from '@meremail/shared'

export const searchRoutes = new Hono()

type EmailResult = EmailSearchHit & { type: 'email' }

interface ContactResult {
  type: 'contact'
  id: number
  name: string | null
  email: string
  isMe: boolean
}

interface AttachmentResult {
  type: 'attachment'
  id: number
  emailId: number
  threadId: number
  filename: string
  mimeType: string | null
  size: number | null
  sentAt: Date | null
  senderName: string | null
  senderEmail: string
}

interface EmailSearchOptions {
  query: SearchQuery
  unreadOnly: boolean
  limit: number
  offset: number
  /** Date range in epoch ms, as the client sees the query's days. Falls back to the server's timezone */
  from: number | null
  to: number | null
}

// Same fallbacks as the `date` the sync feed gives clients
const EMAIL_DATE = 'COALESCE(e.sent_at, e.received_at, e.queued_at, e.created_at)'

/**
 * Search emails with the shared query language. One result per thread: its
 * newest matching email (or its oldest, when sorting oldest first).
 */
function searchEmails(options: EmailSearchOptions): { results: EmailResult[]; hasMore: boolean } {
  const { query, limit, offset } = options
  const unread = options.unreadOnly ? true : query.unread
  if (!hasCriteria(query) && unread === null) return { results: [], hasMore: false }

  const conditions: string[] = []
  const params: (string | number)[] = []

  const match = toFtsMatch(query)
  if (match) {
    conditions.push('emails_fts MATCH ?')
    params.push(match)
  }

  if (query.folders.length > 0) {
    const folderIds = (sqlite
      .prepare(`SELECT id FROM folders WHERE lower(name) IN (${query.folders.map(() => '?').join(',')})`)
      .all(...query.folders) as { id: number }[]).map(f => f.id)
    if (folderIds.length === 0) return { results: [], hasMore: false }
    conditions.push(`t.folder_id IN (${folderIds.join(',')})`)
  }

  if (unread !== null) conditions.push(unread ? 'e.read_at IS NULL' : 'e.read_at IS NOT NULL')
  if (query.hasAttachment) conditions.push('EXISTS (SELECT 1 FROM attachments a WHERE a.email_id = e.id AND a.is_inline = 0)')

  const range = dateRange(query)
  const from = query.after ? options.from ?? range.from : null
  const to = query.before ? options.to ?? range.to : null
  if (from !== null) {
    conditions.push(`${EMAIL_DATE} >= ?`)
    params.push(Math.floor(from / 1000))
  }
  if (to !== null) {
    conditions.push(`${EMAIL_DATE} <= ?`)
    params.push(Math.floor(to / 1000))
  }

  const order = query.sort === 'oldest' ? 'date, id' : 'date DESC, id DESC'
  const rows = sqlite.prepare(`
    SELECT id, matches FROM (
      SELECT id, date,
        ROW_NUMBER() OVER (PARTITION BY threadId ORDER BY ${order}) AS position,
        COUNT(*) OVER (PARTITION BY threadId) AS matches
      FROM (
        SELECT e.id AS id, e.thread_id AS threadId, ${EMAIL_DATE} AS date
        FROM ${match ? 'emails_fts JOIN emails e ON e.id = emails_fts.rowid' : 'emails e'}
        JOIN email_threads t ON t.id = e.thread_id
        ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
      )
    )
    WHERE position = 1
    ORDER BY ${order}
    LIMIT ? OFFSET ?`).all(...params, limit + 1, offset) as { id: number; matches: number }[]

  const hasMore = rows.length > limit
  const page = rows.slice(0, limit)
  if (page.length === 0) return { results: [], hasMore: false }

  const details = new Map((sqlite.prepare(`
    SELECT e.id, e.thread_id AS threadId, e.subject, e.content_text AS contentText, e.read_at AS readAt,
      ${EMAIL_DATE} AS date, c.name AS senderName, c.email AS senderEmail
    FROM emails e
    LEFT JOIN contacts c ON c.id = e.sender_id
    WHERE e.id IN (${page.map(row => row.id).join(',')})`).all() as any[]).map(row => [row.id as number, row]))

  return {
    hasMore,
    results: page.map(({ id, matches }) => {
      const row = details.get(id)
      return {
        type: 'email' as const,
        emailId: id,
        threadId: row.threadId,
        draftId: null,
        subject: row.subject,
        snippet: searchSnippet(row.contentText, query),
        senderName: row.senderName,
        senderEmail: row.senderEmail ?? '',
        date: row.date * 1000,
        isRead: !!row.readAt,
        matches,
      }
    }),
  }
}

type SearchResult = EmailResult | ContactResult | AttachmentResult

// GET /api/search
searchRoutes.get('/', async (c) => {
  const q = (c.req.query('q') || '').trim()
  const type = c.req.query('type')
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 50)
  const offset = parseInt(c.req.query('offset') || '0')
  const dateFrom = c.req.query('dateFrom')
  const dateTo = c.req.query('dateTo')
  const senderId = c.req.query('senderId') ? parseInt(c.req.query('senderId')!) : null
  const fileType = c.req.query('fileType')
  const unreadOnly = c.req.query('unreadOnly') === 'true'

  const dateFromUnix = dateFrom ? Math.floor(new Date(dateFrom).getTime() / 1000) : null
  const dateToUnix = dateTo ? Math.floor(new Date(dateTo + 'T23:59:59').getTime() / 1000) : null

  const fileTypeToMime: Record<string, string[]> = {
    'image': ['image/'],
    'document': ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml', 'text/plain', 'text/rtf'],
    'spreadsheet': ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml'],
    'presentation': ['application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml'],
    'archive': ['application/zip', 'application/x-rar', 'application/x-7z', 'application/gzip', 'application/x-tar'],
    'audio': ['audio/'],
    'video': ['video/'],
  }

  const results: SearchResult[] = []
  let hasMore = false

  const hasSearchTerm = q.length >= 2
  // Escape FTS5 special characters
  const searchTerm = hasSearchTerm ? q.replace(/['"*()@\-+.:^]/g, ' ').trim() + '*' : ''

  // Search emails
  if (!type || type === 'email') {
    const page = searchEmails({
      // Untrimmed: a trailing space means the last word is finished
      query: parseQuery(c.req.query('q') || ''),
      unreadOnly,
      limit,
      offset: type ? offset : 0,
      from: c.req.query('from') ? Number(c.req.query('from')) : null,
      to: c.req.query('to') ? Number(c.req.query('to')) : null,
    })
    results.push(...page.results)
    if (type === 'email') hasMore = page.hasMore
  }

  // Search contacts
  if (hasSearchTerm && (!type || type === 'contact')) {
    const contactSql = `
      SELECT
        c.id,
        c.name,
        c.email,
        c.is_me as isMe
      FROM contacts_fts
      JOIN contacts c ON contacts_fts.rowid = c.id
      WHERE contacts_fts MATCH ?
      ORDER BY rank, c.created_at DESC
      LIMIT ? OFFSET ?`

    const contactRows = sqlite.prepare(contactSql).all(searchTerm, limit + 1, type ? offset : 0) as any[]

    if (type === 'contact' && contactRows.length > limit) {
      hasMore = true
      contactRows.pop()
    }

    for (const row of contactRows.slice(0, limit)) {
      results.push({
        type: 'contact',
        id: row.id,
        name: row.name,
        email: row.email,
        isMe: !!row.isMe,
      })
    }
  }

  // Search attachments
  if (type === 'attachment' || (hasSearchTerm && !type)) {
    let attachmentSql: string
    const attachmentParams: any[] = []

    if (hasSearchTerm) {
      attachmentSql = `
        SELECT
          a.id,
          a.email_id as emailId,
          e.thread_id as threadId,
          a.filename,
          a.mime_type as mimeType,
          a.size,
          e.sent_at as sentAt,
          c.name as senderName,
          c.email as senderEmail
        FROM attachments_fts
        JOIN attachments a ON attachments_fts.rowid = a.id
        JOIN emails e ON a.email_id = e.id
        LEFT JOIN contacts c ON e.sender_id = c.id
        WHERE attachments_fts MATCH ?`
      attachmentParams.push(searchTerm)
    } else {
      attachmentSql = `
        SELECT
          a.id,
          a.email_id as emailId,
          e.thread_id as threadId,
          a.filename,
          a.mime_type as mimeType,
          a.size,
          e.sent_at as sentAt,
          c.name as senderName,
          c.email as senderEmail
        FROM attachments a
        JOIN emails e ON a.email_id = e.id
        LEFT JOIN contacts c ON e.sender_id = c.id
        WHERE a.is_inline = 0`
    }

    if (senderId) {
      attachmentSql += ` AND e.sender_id = ?`
      attachmentParams.push(senderId)
    }
    if (fileType && fileTypeToMime[fileType]) {
      const mimePatterns = fileTypeToMime[fileType]
      const mimeConditions = mimePatterns.map(pattern => {
        attachmentParams.push(pattern + '%')
        return `a.mime_type LIKE ?`
      })
      attachmentSql += ` AND (${mimeConditions.join(' OR ')})`
    }
    if (dateFromUnix) {
      attachmentSql += ` AND e.sent_at >= ?`
      attachmentParams.push(dateFromUnix)
    }
    if (dateToUnix) {
      attachmentSql += ` AND e.sent_at <= ?`
      attachmentParams.push(dateToUnix)
    }

    attachmentSql += hasSearchTerm
      ? ` ORDER BY rank, e.sent_at DESC LIMIT ? OFFSET ?`
      : ` ORDER BY e.sent_at DESC LIMIT ? OFFSET ?`
    attachmentParams.push(limit + 1, offset)

    const attachmentRows = sqlite.prepare(attachmentSql).all(...attachmentParams) as any[]

    if (type === 'attachment' && attachmentRows.length > limit) {
      hasMore = true
      attachmentRows.pop()
    }

    for (const row of attachmentRows.slice(0, limit)) {
      results.push({
        type: 'attachment',
        id: row.id,
        emailId: row.emailId,
        threadId: row.threadId,
        filename: row.filename,
        mimeType: row.mimeType,
        size: row.size,
        sentAt: row.sentAt ? new Date(row.sentAt * 1000) : null,
        senderName: row.senderName,
        senderEmail: row.senderEmail,
      })
    }
  }

  return c.json({ results, query: q, hasMore })
})
