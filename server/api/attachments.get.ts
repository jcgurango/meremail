import { db, sqlite } from '../db'
import { attachments, emails, emailThreads, contacts } from '../db/schema'
import { eq, desc, and, sql, inArray, or, like } from 'drizzle-orm'

// Map file categories to mime type patterns
const FILE_CATEGORIES: Record<string, string[]> = {
  images: ['image/%'],
  videos: ['video/%'],
  audio: ['audio/%'],
  documents: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml%', 'text/plain', 'text/markdown'],
  spreadsheets: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml%', 'text/csv'],
  presentations: ['application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml%'],
  archives: ['application/zip', 'application/x-rar%', 'application/x-7z%', 'application/gzip', 'application/x-tar'],
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 50, 100)
  const offset = Number(query.offset) || 0
  const fileType = query.fileType as string | undefined
  const contactId = query.contactId ? Number(query.contactId) : undefined
  const contactSearch = (query.contactSearch as string || '').trim()
  const textSearch = (query.q as string || '').trim()

  // If text search is provided, use FTS
  let items: any[] = []
  let hasMore = false

  if (textSearch && textSearch.length >= 2) {
    // Use FTS5 search
    const searchTerm = textSearch.replace(/['"*()]/g, ' ').trim() + '*'

    let ftsSql = `
      SELECT
        a.id,
        a.filename,
        a.mime_type as mimeType,
        a.size,
        a.email_id as emailId,
        e.thread_id as threadId,
        t.subject as threadSubject,
        e.sent_at as sentAt,
        e.sender_id as senderId,
        c.name as senderName,
        c.email as senderEmail
      FROM attachments_fts
      JOIN attachments a ON attachments_fts.rowid = a.id
      JOIN emails e ON a.email_id = e.id
      JOIN email_threads t ON e.thread_id = t.id
      LEFT JOIN contacts c ON e.sender_id = c.id
      WHERE attachments_fts MATCH ?
        AND a.is_inline = 0`

    const ftsParams: any[] = [searchTerm]

    if (fileType && FILE_CATEGORIES[fileType]) {
      const patterns = FILE_CATEGORIES[fileType]
      const mimeConditions = patterns.map(p => {
        ftsParams.push(p.replace('%', '') + '%')
        return `a.mime_type LIKE ?`
      })
      ftsSql += ` AND (${mimeConditions.join(' OR ')})`
    }

    if (contactId) {
      ftsSql += ` AND e.sender_id = ?`
      ftsParams.push(contactId)
    }

    ftsSql += ` ORDER BY rank, e.sent_at DESC LIMIT ? OFFSET ?`
    ftsParams.push(limit + 1, offset)

    const ftsResults = sqlite.prepare(ftsSql).all(...ftsParams) as any[]
    hasMore = ftsResults.length > limit
    items = ftsResults.slice(0, limit).map(row => ({
      ...row,
      sentAt: row.sentAt ? new Date(row.sentAt * 1000) : null,
    }))
  } else {
    // Regular query without FTS
    // Build WHERE conditions
    const conditions = [eq(attachments.isInline, false)]

    // File type filter
    if (fileType && FILE_CATEGORIES[fileType]) {
      const patterns = FILE_CATEGORIES[fileType]
      const mimeConditions = patterns.map(pattern =>
        like(attachments.mimeType, pattern)
      )
      conditions.push(or(...mimeConditions)!)
    }

    // Contact filter - filter by email sender
    if (contactId) {
      conditions.push(eq(emails.senderId, contactId))
    }

    // Query attachments with email and thread info
    const results = await db
      .select({
        id: attachments.id,
        filename: attachments.filename,
        mimeType: attachments.mimeType,
        size: attachments.size,
        emailId: attachments.emailId,
        threadId: emails.threadId,
        threadSubject: emailThreads.subject,
        sentAt: emails.sentAt,
        senderId: emails.senderId,
        senderName: contacts.name,
        senderEmail: contacts.email,
      })
      .from(attachments)
      .innerJoin(emails, eq(attachments.emailId, emails.id))
      .innerJoin(emailThreads, eq(emails.threadId, emailThreads.id))
      .leftJoin(contacts, eq(emails.senderId, contacts.id))
      .where(and(...conditions))
      .orderBy(desc(emails.sentAt))
      .limit(limit + 1)
      .offset(offset)

    hasMore = results.length > limit
    items = results.slice(0, limit)
  }

  // Get available file type categories (for filter UI)
  // Counts should reflect current search/contact filters (but not file type filter)
  const categories: Record<string, number> = {}

  if (textSearch && textSearch.length >= 2) {
    // Use FTS to count categories within search results
    const searchTerm = textSearch.replace(/['"*()]/g, ' ').trim() + '*'
    let countSql = `
      SELECT a.mime_type as mimeType, COUNT(*) as count
      FROM attachments_fts
      JOIN attachments a ON attachments_fts.rowid = a.id
      JOIN emails e ON a.email_id = e.id
      WHERE attachments_fts MATCH ?
        AND a.is_inline = 0`
    const countParams: any[] = [searchTerm]

    if (contactId) {
      countSql += ` AND e.sender_id = ?`
      countParams.push(contactId)
    }

    countSql += ` GROUP BY a.mime_type`
    const typeCounts = sqlite.prepare(countSql).all(...countParams) as { mimeType: string | null; count: number }[]

    for (const { mimeType, count } of typeCounts) {
      if (!mimeType) continue
      for (const [category, patterns] of Object.entries(FILE_CATEGORIES)) {
        const matches = patterns.some(pattern => {
          if (pattern.endsWith('%')) {
            return mimeType.startsWith(pattern.slice(0, -1))
          }
          return mimeType === pattern
        })
        if (matches) {
          categories[category] = (categories[category] || 0) + count
          break
        }
      }
    }
  } else {
    // No text search - count with optional contact filter
    const countConditions = [eq(attachments.isInline, false)]
    if (contactId) {
      countConditions.push(eq(emails.senderId, contactId))
    }

    const typeCounts = await db
      .select({
        mimeType: attachments.mimeType,
        count: sql<number>`COUNT(*)`.as('count'),
      })
      .from(attachments)
      .innerJoin(emails, eq(attachments.emailId, emails.id))
      .where(and(...countConditions))
      .groupBy(attachments.mimeType)

    for (const { mimeType, count } of typeCounts) {
      if (!mimeType) continue
      for (const [category, patterns] of Object.entries(FILE_CATEGORIES)) {
        const matches = patterns.some(pattern => {
          if (pattern.endsWith('%')) {
            return mimeType.startsWith(pattern.slice(0, -1))
          }
          return mimeType === pattern
        })
        if (matches) {
          categories[category] = (categories[category] || 0) + count
          break
        }
      }
    }
  }

  // Get contacts who have sent attachments (for filter UI)
  // If there's a text search, only show contacts with matching attachments
  let senderContacts: { id: number; name: string | null; email: string }[] = []

  if (textSearch && textSearch.length >= 2) {
    // Use FTS to find contacts with matching attachments
    const searchTerm = textSearch.replace(/['"*()]/g, ' ').trim() + '*'
    let contactSql = `
      SELECT DISTINCT c.id, c.name, c.email
      FROM attachments_fts
      JOIN attachments a ON attachments_fts.rowid = a.id
      JOIN emails e ON a.email_id = e.id
      JOIN contacts c ON e.sender_id = c.id
      WHERE attachments_fts MATCH ?
        AND a.is_inline = 0`
    const contactParams: any[] = [searchTerm]

    if (contactSearch) {
      contactSql += ` AND (c.name LIKE ? OR c.email LIKE ?)`
      const searchPattern = `%${contactSearch}%`
      contactParams.push(searchPattern, searchPattern)
    }

    contactSql += ` ORDER BY c.name LIMIT 20`
    senderContacts = sqlite.prepare(contactSql).all(...contactParams) as any[]
  } else {
    // No text search - show all contacts with attachments
    const contactConditions = [eq(attachments.isInline, false)]
    if (contactSearch) {
      const searchPattern = `%${contactSearch}%`
      contactConditions.push(
        or(
          like(contacts.name, searchPattern),
          like(contacts.email, searchPattern)
        )!
      )
    }

    senderContacts = await db
      .selectDistinct({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
      })
      .from(attachments)
      .innerJoin(emails, eq(attachments.emailId, emails.id))
      .innerJoin(contacts, eq(emails.senderId, contacts.id))
      .where(and(...contactConditions))
      .orderBy(contacts.name)
      .limit(20)
  }

  return {
    attachments: items.map(item => ({
      id: item.id,
      filename: item.filename,
      mimeType: item.mimeType,
      size: item.size,
      threadId: item.threadId,
      threadSubject: item.threadSubject,
      sentAt: item.sentAt,
      sender: item.senderId ? {
        id: item.senderId,
        name: item.senderName,
        email: item.senderEmail,
      } : null,
    })),
    hasMore,
    filters: {
      categories,
      contacts: senderContacts,
    },
  }
})
