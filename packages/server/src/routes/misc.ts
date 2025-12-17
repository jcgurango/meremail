import { Hono } from 'hono'
import { eq, desc, sql, and, isNull, isNotNull, notInArray, inArray } from 'drizzle-orm'
import {
  db,
  emails,
  emailThreads,
  contacts,
  emailContacts,
  attachments,
  folders,
} from '@meremail/shared'
import { proxyImagesInHtml } from '../utils/proxy-images'
import { replaceCidReferences } from '../utils/replace-cid'

export const miscRoutes = new Hono()

// GET /api/set-aside
miscRoutes.get('/set-aside', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100)
  const excludeParam = c.req.query('exclude') || ''
  const excludeIds = excludeParam ? excludeParam.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id)) : []

  // Get threads that are set aside
  const setAsideThreadIds = db
    .select({ id: emailThreads.id })
    .from(emailThreads)
    .where(isNotNull(emailThreads.setAsideAt))
    .orderBy(desc(emailThreads.setAsideAt))
    .all()
    .map(t => t.id)

  if (setAsideThreadIds.length === 0) {
    return c.json({ emails: [], hasMore: false })
  }

  // Get emails from those threads
  const whereClause = excludeIds.length > 0
    ? and(inArray(emails.threadId, setAsideThreadIds), notInArray(emails.id, excludeIds))
    : inArray(emails.threadId, setAsideThreadIds)

  const setAsideEmails = db
    .select({
      id: emails.id,
      threadId: emails.threadId,
      subject: emails.subject,
      contentText: emails.contentText,
      contentHtml: emails.contentHtml,
      sentAt: emails.sentAt,
      receivedAt: emails.receivedAt,
      readAt: emails.readAt,
      senderId: emails.senderId,
      headers: emails.headers,
    })
    .from(emails)
    .where(whereClause)
    .orderBy(desc(emails.sentAt))
    .limit(limit + 1)
    .all()

  const hasMore = setAsideEmails.length > limit
  const emailList = hasMore ? setAsideEmails.slice(0, limit) : setAsideEmails

  const emailsWithDetails = emailList.map((email) => {
    const sender = email.senderId
      ? db.select().from(contacts).where(eq(contacts.id, email.senderId)).get()
      : null

    const recipients = db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        isMe: contacts.isMe,
        role: emailContacts.role,
      })
      .from(emailContacts)
      .innerJoin(contacts, eq(contacts.id, emailContacts.contactId))
      .where(eq(emailContacts.emailId, email.id))
      .all()
      .filter((r) => r.role !== 'from')

    let content: string
    if (email.contentHtml) {
      const withCidReplaced = replaceCidReferences(email.contentHtml, email.id)
      content = proxyImagesInHtml(withCidReplaced)
    } else if (email.contentText?.trim()) {
      content = `<pre style="white-space: pre-wrap; font-family: inherit;">${email.contentText}</pre>`
    } else {
      content = ''
    }

    const emailAttachments = db
      .select({
        id: attachments.id,
        filename: attachments.filename,
        mimeType: attachments.mimeType,
        size: attachments.size,
      })
      .from(attachments)
      .where(and(eq(attachments.emailId, email.id), eq(attachments.isInline, false)))
      .all()

    const headers = email.headers as Record<string, string> | null
    const replyToRaw = headers?.['reply-to']
    let replyTo: string | null = null
    if (replyToRaw) {
      const match = replyToRaw.match(/<([^>]+)>/) || replyToRaw.match(/([^\s<>]+@[^\s<>]+)/)
      replyTo = match?.[1] ?? replyToRaw
    }

    return {
      id: email.id,
      threadId: email.threadId,
      subject: email.subject,
      content,
      sentAt: email.sentAt,
      receivedAt: email.receivedAt,
      isRead: !!email.readAt,
      sender: sender ? { id: sender.id, name: sender.name, email: sender.email, isMe: sender.isMe } : null,
      recipients,
      attachments: emailAttachments,
      replyTo,
      headers,
    }
  })

  return c.json({ emails: emailsWithDetails, hasMore })
})

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

// GET /api/unread-counts
miscRoutes.get('/unread-counts', async (c) => {
  // Get all folders with their unread counts
  const folderList = db.select().from(folders).orderBy(folders.position).all()

  const folderCounts: Record<number, number> = {}
  for (const folder of folderList) {
    const unread = db
      .select({ count: sql<number>`COUNT(DISTINCT ${emailThreads.id})` })
      .from(emailThreads)
      .innerJoin(emails, eq(emails.threadId, emailThreads.id))
      .where(and(eq(emailThreads.folderId, folder.id), isNull(emails.readAt)))
      .get()
    folderCounts[folder.id] = unread?.count || 0
  }

  const replyLaterCount = db
    .select({ count: sql<number>`COUNT(DISTINCT ${emailThreads.id})` })
    .from(emailThreads)
    .leftJoin(emails, eq(emails.threadId, emailThreads.id))
    .where(sql`${emailThreads.replyLaterAt} IS NOT NULL OR ${emails.status} = 'draft'`)
    .get()

  const setAsideCount = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emailThreads)
    .where(isNotNull(emailThreads.setAsideAt))
    .get()

  return c.json({
    folders: folderCounts,
    reply_later: replyLaterCount?.count || 0,
    set_aside: setAsideCount?.count || 0,
  })
})
