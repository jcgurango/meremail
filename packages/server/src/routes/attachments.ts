import { Hono } from 'hono'
import { eq, desc, and, sql, or, like } from 'drizzle-orm'
import { createReadStream, existsSync } from 'fs'
import { Readable } from 'stream'
import { db, sqlite, attachments, emails, emailThreads, contacts, resolveAttachmentPath } from '@meremail/shared'

export const attachmentsRoutes = new Hono()

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

// GET /api/attachments
attachmentsRoutes.get('/', async (c) => {
  const limit = Math.min(Number(c.req.query('limit')) || 50, 100)
  const offset = Number(c.req.query('offset')) || 0
  const fileType = c.req.query('fileType')
  const contactId = c.req.query('contactId') ? Number(c.req.query('contactId')) : undefined
  const contactSearch = (c.req.query('contactSearch') || '').trim()
  const textSearch = (c.req.query('q') || '').trim()

  let items: any[] = []
  let hasMore = false

  if (textSearch && textSearch.length >= 2) {
    // Escape FTS5 special characters
    const searchTerm = textSearch.replace(/['"*()@\-+.:^]/g, ' ').trim() + '*'

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
    const conditions = [
      eq(attachments.isInline, false),
    ]

    if (fileType && FILE_CATEGORIES[fileType]) {
      const patterns = FILE_CATEGORIES[fileType]
      const mimeConditions = patterns.map(pattern => like(attachments.mimeType, pattern))
      conditions.push(or(...mimeConditions)!)
    }

    if (contactId) {
      conditions.push(eq(emails.senderId, contactId))
    }

    const results = db
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
      .all()

    hasMore = results.length > limit
    items = results.slice(0, limit)
  }

  // Get category counts
  const categories: Record<string, number> = {}
  const countConditions = [
    eq(attachments.isInline, false),
  ]
  if (contactId) {
    countConditions.push(eq(emails.senderId, contactId))
  }

  const typeCounts = db
    .select({
      mimeType: attachments.mimeType,
      count: sql<number>`COUNT(*)`.as('count'),
    })
    .from(attachments)
    .innerJoin(emails, eq(attachments.emailId, emails.id))
    .leftJoin(contacts, eq(emails.senderId, contacts.id))
    .where(and(...countConditions))
    .groupBy(attachments.mimeType)
    .all()

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

  // Get sender contacts
  const senderConditions = [
    eq(attachments.isInline, false),
  ]
  if (contactSearch) {
    const searchPattern = `%${contactSearch}%`
    senderConditions.push(or(like(contacts.name, searchPattern), like(contacts.email, searchPattern))!)
  }

  const senderContacts = db
    .selectDistinct({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
    })
    .from(attachments)
    .innerJoin(emails, eq(attachments.emailId, emails.id))
    .innerJoin(contacts, eq(emails.senderId, contacts.id))
    .where(and(...senderConditions))
    .orderBy(contacts.name)
    .limit(20)
    .all()

  return c.json({
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
  })
})

// GET /api/attachments/:id
attachmentsRoutes.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid attachment ID' }, 400)
  }

  const attachment = db
    .select()
    .from(attachments)
    .where(eq(attachments.id, id))
    .get()

  if (!attachment) {
    return c.json({ error: 'Attachment not found' }, 404)
  }

  const resolvedPath = resolveAttachmentPath(attachment.filePath)
  if (!existsSync(resolvedPath)) {
    return c.json({ error: 'Attachment file not found on disk' }, 404)
  }

  const stream = createReadStream(resolvedPath)
  const webStream = Readable.toWeb(stream) as ReadableStream

  return new Response(webStream, {
    headers: {
      'Content-Type': attachment.mimeType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${attachment.filename}"`,
      ...(attachment.size ? { 'Content-Length': String(attachment.size) } : {}),
    },
  })
})

// GET /api/attachments/:id/details
attachmentsRoutes.get('/:id/details', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid attachment ID' }, 400)
  }

  const attachment = db
    .select({
      id: attachments.id,
      filename: attachments.filename,
      mimeType: attachments.mimeType,
      size: attachments.size,
      emailId: attachments.emailId,
      isInline: attachments.isInline,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .where(eq(attachments.id, id))
    .get()

  if (!attachment) {
    return c.json({ error: 'Attachment not found' }, 404)
  }

  return c.json(attachment)
})

// DELETE /api/attachments/:id
attachmentsRoutes.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid attachment ID' }, 400)
  }

  const attachment = db
    .select()
    .from(attachments)
    .where(eq(attachments.id, id))
    .get()

  if (!attachment) {
    return c.json({ error: 'Attachment not found' }, 404)
  }

  // Delete from database
  db.delete(attachments).where(eq(attachments.id, id)).run()

  // Try to delete file (don't fail if file doesn't exist)
  try {
    const { unlinkSync } = await import('fs')
    const resolvedPath = resolveAttachmentPath(attachment.filePath)
    if (existsSync(resolvedPath)) {
      unlinkSync(resolvedPath)
    }
  } catch (e) {
    console.error('Failed to delete attachment file:', e)
  }

  return c.json({ success: true })
})
