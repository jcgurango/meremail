import { Hono } from 'hono'
import { sqlite } from '@meremail/shared'

export const searchRoutes = new Hono()

interface EmailResult {
  type: 'email'
  id: number
  threadId: number
  subject: string
  snippet: string
  senderName: string | null
  senderEmail: string
  sentAt: Date | null
  isRead: boolean
}

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
  const folderIdsParam = c.req.query('folderIds')
  const folderIds = folderIdsParam ? folderIdsParam.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : null
  const unreadOnly = c.req.query('unreadOnly') === 'true'
  const sortBy = c.req.query('sortBy') || 'relevance' // 'relevance' or 'date'

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
  const hasEmailFilters = senderId || dateFromUnix || dateToUnix || (folderIds && folderIds.length > 0) || unreadOnly
  if ((hasSearchTerm || (type === 'email' && hasEmailFilters)) && (!type || type === 'email')) {
    let emailSql: string
    const emailParams: any[] = []

    if (hasSearchTerm) {
      emailSql = `
        SELECT
          e.id,
          e.thread_id as threadId,
          e.subject,
          SUBSTR(e.content_text, 1, 150) as snippet,
          e.sent_at as sentAt,
          e.read_at as readAt,
          c.name as senderName,
          c.email as senderEmail
        FROM emails_fts
        JOIN emails e ON emails_fts.rowid = e.id
        JOIN email_threads t ON e.thread_id = t.id
        LEFT JOIN contacts c ON e.sender_id = c.id
        WHERE emails_fts MATCH ?`
      emailParams.push(searchTerm)
    } else {
      emailSql = `
        SELECT
          e.id,
          e.thread_id as threadId,
          e.subject,
          SUBSTR(e.content_text, 1, 150) as snippet,
          e.sent_at as sentAt,
          e.read_at as readAt,
          c.name as senderName,
          c.email as senderEmail
        FROM emails e
        JOIN email_threads t ON e.thread_id = t.id
        LEFT JOIN contacts c ON e.sender_id = c.id
        WHERE 1=1`
    }

    if (senderId) {
      emailSql += ` AND e.sender_id = ?`
      emailParams.push(senderId)
    }
    if (folderIds && folderIds.length > 0) {
      emailSql += ` AND t.folder_id IN (${folderIds.map(() => '?').join(',')})`
      emailParams.push(...folderIds)
    }
    if (unreadOnly) {
      emailSql += ` AND e.read_at IS NULL`
    }
    if (dateFromUnix) {
      emailSql += ` AND e.sent_at >= ?`
      emailParams.push(dateFromUnix)
    }
    if (dateToUnix) {
      emailSql += ` AND e.sent_at <= ?`
      emailParams.push(dateToUnix)
    }

    // Sort order: relevance (rank) or date
    if (hasSearchTerm && sortBy === 'relevance') {
      emailSql += ` ORDER BY rank, e.sent_at DESC LIMIT ? OFFSET ?`
    } else {
      emailSql += ` ORDER BY e.sent_at DESC LIMIT ? OFFSET ?`
    }
    emailParams.push(limit + 1, type ? offset : 0)

    const emailRows = sqlite.prepare(emailSql).all(...emailParams) as any[]

    if (type === 'email' && emailRows.length > limit) {
      hasMore = true
      emailRows.pop()
    }

    for (const row of emailRows.slice(0, limit)) {
      results.push({
        type: 'email',
        id: row.id,
        threadId: row.threadId,
        subject: row.subject,
        snippet: row.snippet?.replace(/\s+/g, ' ').trim() || '',
        senderName: row.senderName,
        senderEmail: row.senderEmail,
        sentAt: row.sentAt ? new Date(row.sentAt * 1000) : null,
        isRead: !!row.readAt,
      })
    }
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
