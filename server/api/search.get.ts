import { sqlite } from '../db'

interface EmailResult {
  type: 'email'
  id: number
  threadId: number
  subject: string
  snippet: string
  senderName: string | null
  senderEmail: string
  sentAt: Date | null
}

interface ContactResult {
  type: 'contact'
  id: number
  name: string | null
  email: string
  bucket: string | null
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

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const q = (query.q as string || '').trim()
  const type = query.type as string | undefined  // 'email', 'contact', 'attachment', or undefined for all
  const limit = Math.min(parseInt(query.limit as string) || 20, 50)
  const offset = parseInt(query.offset as string) || 0
  const dateFrom = query.dateFrom as string | undefined  // ISO date string
  const dateTo = query.dateTo as string | undefined  // ISO date string
  const senderId = query.senderId ? parseInt(query.senderId as string) : null  // Filter by sender contact ID
  const fileType = query.fileType as string | undefined  // Filter attachments by mime type category

  // Build date filter values
  const dateFromUnix = dateFrom ? Math.floor(new Date(dateFrom).getTime() / 1000) : null
  const dateToUnix = dateTo ? Math.floor(new Date(dateTo + 'T23:59:59').getTime() / 1000) : null

  // File type to mime type prefix mapping
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

  // For FTS searches, require at least 2 chars
  const hasSearchTerm = q.length >= 2
  const searchTerm = hasSearchTerm ? q.replace(/['"*()]/g, ' ').trim() + '*' : ''

  // Search/browse emails (search term optional if other filters provided and type=email)
  const hasEmailFilters = senderId || dateFromUnix || dateToUnix
  if ((hasSearchTerm || (type === 'email' && hasEmailFilters)) && (!type || type === 'email')) {
    let emailSql: string
    const emailParams: any[] = []

    if (hasSearchTerm) {
      // FTS search - exclude quarantined contacts
      emailSql = `
        SELECT
          e.id,
          e.thread_id as threadId,
          e.subject,
          SUBSTR(e.content_text, 1, 150) as snippet,
          e.sent_at as sentAt,
          c.name as senderName,
          c.email as senderEmail
        FROM emails_fts
        JOIN emails e ON emails_fts.rowid = e.id
        LEFT JOIN contacts c ON e.sender_id = c.id
        WHERE emails_fts MATCH ?
          AND (c.bucket IS NULL OR c.bucket != 'quarantine')`
      emailParams.push(searchTerm)
    } else {
      // Browse emails (no search term, but has filters) - exclude quarantined contacts
      emailSql = `
        SELECT
          e.id,
          e.thread_id as threadId,
          e.subject,
          SUBSTR(e.content_text, 1, 150) as snippet,
          e.sent_at as sentAt,
          c.name as senderName,
          c.email as senderEmail
        FROM emails e
        LEFT JOIN contacts c ON e.sender_id = c.id
        WHERE (c.bucket IS NULL OR c.bucket != 'quarantine')`
    }

    if (senderId) {
      emailSql += ` AND e.sender_id = ?`
      emailParams.push(senderId)
    }
    if (dateFromUnix) {
      emailSql += ` AND e.sent_at >= ?`
      emailParams.push(dateFromUnix)
    }
    if (dateToUnix) {
      emailSql += ` AND e.sent_at <= ?`
      emailParams.push(dateToUnix)
    }

    emailSql += hasSearchTerm
      ? ` ORDER BY rank, e.sent_at DESC LIMIT ? OFFSET ?`
      : ` ORDER BY e.sent_at DESC LIMIT ? OFFSET ?`
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
      })
    }
  }

  // Search contacts (requires search term)
  if (hasSearchTerm && (!type || type === 'contact')) {
    const contactSql = `
      SELECT
        c.id,
        c.name,
        c.email,
        c.bucket,
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
        bucket: row.bucket,
        isMe: !!row.isMe,
      })
    }
  }

  // Search/browse attachments (search term optional for type=attachment)
  if (type === 'attachment' || (hasSearchTerm && !type)) {
    let attachmentSql: string
    const attachmentParams: any[] = []

    if (hasSearchTerm) {
      // FTS search - exclude quarantined contacts
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
        WHERE attachments_fts MATCH ?
          AND (c.bucket IS NULL OR c.bucket != 'quarantine')`
      attachmentParams.push(searchTerm)
    } else {
      // Browse all attachments (no search term) - exclude quarantined contacts
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
        WHERE a.is_inline = 0
          AND (c.bucket IS NULL OR c.bucket != 'quarantine')`
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

  return { results, query: q, hasMore }
})
