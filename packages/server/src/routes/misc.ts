import { Hono } from 'hono'
import { eq, desc, sql, and, isNull, inArray } from 'drizzle-orm'
import {
  db,
  emails,
  emailThreads,
  contacts,
  folders,
} from '@meremail/shared'

export const miscRoutes = new Hono()

// POST /api/emails/mark-read
miscRoutes.post('/emails/mark-read', async (c) => {
  const body = await c.req.json()
  const ids = body?.ids as number[]

  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ error: 'ids must be a non-empty array' }, 400)
  }

  // Validate all IDs are numbers
  if (!ids.every(id => typeof id === 'number' && !isNaN(id))) {
    return c.json({ error: 'All ids must be valid numbers' }, 400)
  }

  // Mark emails as read (only if not already read)
  db.update(emails)
    .set({ readAt: new Date() })
    .where(sql`${emails.id} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)}) AND ${emails.readAt} IS NULL`)
    .run()

  return c.json({ success: true, count: ids.length })
})

// GET /api/notifications/pending
// Returns unread emails from folders with notifications enabled
miscRoutes.get('/notifications/pending', async (c) => {
  // Get folder IDs that have notifications enabled
  const notificationFolders = db
    .select({ id: folders.id })
    .from(folders)
    .where(eq(folders.notificationsEnabled, true))
    .all()
    .map(f => f.id)

  if (notificationFolders.length === 0) {
    return c.json({ emails: [] })
  }

  // Get unread emails from folders with notifications enabled
  const unreadEmails = db
    .select({
      id: emails.id,
      threadId: emails.threadId,
      subject: emails.subject,
      contentText: emails.contentText,
      sentAt: emails.sentAt,
      senderName: contacts.name,
      senderEmail: contacts.email,
    })
    .from(emails)
    .innerJoin(emailThreads, eq(emails.threadId, emailThreads.id))
    .innerJoin(contacts, eq(contacts.id, emails.senderId))
    .where(and(
      isNull(emails.readAt),
      eq(contacts.isMe, false), // Don't notify for own emails
      inArray(emailThreads.folderId, notificationFolders)
    ))
    .orderBy(desc(emails.sentAt))
    .limit(50)
    .all()

  return c.json({
    emails: unreadEmails.map(e => ({
      id: e.id,
      threadId: e.threadId,
      subject: e.subject || '(No subject)',
      snippet: (e.contentText || '').substring(0, 100),
      sentAt: e.sentAt,
      senderName: e.senderName,
      senderEmail: e.senderEmail,
    })),
  })
})

// GET /api/emails/:id/headers
// Raw headers aren't synced to clients; they're fetched when someone asks to see them
miscRoutes.get('/emails/:id/headers', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid email ID' }, 400)
  }

  const email = db
    .select({ headers: emails.headers })
    .from(emails)
    .where(eq(emails.id, id))
    .get()

  if (!email) {
    return c.json({ error: 'Email not found' }, 404)
  }

  return c.json({ headers: email.headers || [] })
})
