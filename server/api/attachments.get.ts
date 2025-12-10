import { db } from '../db'
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

  const hasMore = results.length > limit
  const items = results.slice(0, limit)

  // Get available file type categories (for filter UI)
  const typeCounts = await db
    .select({
      mimeType: attachments.mimeType,
      count: sql<number>`COUNT(*)`.as('count'),
    })
    .from(attachments)
    .where(eq(attachments.isInline, false))
    .groupBy(attachments.mimeType)

  // Aggregate into categories
  const categories: Record<string, number> = {}
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

  // Get contacts who have sent attachments (for filter UI)
  // Server-side search with limit
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

  const senderContacts = await db
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
