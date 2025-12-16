import { Hono } from 'hono'
import { eq, desc, sql, and, isNull, isNotNull, notInArray, inArray } from 'drizzle-orm'
import {
  db,
  emails,
  emailThreads,
  contacts,
  emailContacts,
  attachments,
} from '@meremail/shared'
import { proxyImagesInHtml } from '../utils/proxy-images'
import { replaceCidReferences } from '../utils/replace-cid'

export const miscRoutes = new Hono()

// GET /api/feed
miscRoutes.get('/feed', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '10'), 100)
  const bucket = c.req.query('bucket') || 'feed'
  const excludeParam = c.req.query('exclude') || ''
  const excludeIds = excludeParam ? excludeParam.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id)) : []

  if (bucket !== 'feed' && bucket !== 'paper_trail') {
    return c.json({ error: 'Invalid bucket. Must be "feed" or "paper_trail"' }, 400)
  }

  const whereClause = excludeIds.length > 0
    ? and(eq(contacts.bucket, bucket), notInArray(emails.id, excludeIds))
    : eq(contacts.bucket, bucket)

  const feedEmails = db
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
    .innerJoin(contacts, eq(contacts.id, emails.senderId))
    .where(whereClause)
    .orderBy(
      sql`CASE WHEN ${emails.readAt} IS NULL THEN 0 ELSE 1 END`,
      desc(sql`MAX(COALESCE(${emails.readAt}, 0), ${emails.sentAt})`)
    )
    .limit(limit + 1)
    .all()

  const hasMore = feedEmails.length > limit
  const emailList = hasMore ? feedEmails.slice(0, limit) : feedEmails

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
      try {
        const parsed = JSON.parse(replyToRaw)
        if (parsed && typeof parsed === 'object') {
          if (parsed.text) {
            replyTo = parsed.text
          } else if (Array.isArray(parsed.value)) {
            replyTo = parsed.value
              .map((v: { name?: string; address?: string }) =>
                v.name ? `${v.name} <${v.address}>` : v.address
              )
              .filter(Boolean)
              .join(', ')
          }
        }
      } catch {
        replyTo = replyToRaw
      }
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

  const unreadCount = emailsWithDetails.filter(e => !e.isRead).length

  return c.json({
    emails: emailsWithDetails,
    hasMore,
    unreadCount,
  })
})

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

// GET /api/screener
miscRoutes.get('/screener', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100)
  const offset = parseInt(c.req.query('offset') || '0')

  const unscreenedContacts = db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
      createdAt: contacts.createdAt,
      lastEmailAt: sql<number>`MAX(${emails.sentAt})`.as('last_email_at'),
      emailCount: sql<number>`COUNT(DISTINCT ${emails.id})`.as('email_count'),
    })
    .from(contacts)
    .leftJoin(emailContacts, eq(contacts.id, emailContacts.contactId))
    .leftJoin(emails, eq(emailContacts.emailId, emails.id))
    .where(and(isNull(contacts.bucket), eq(contacts.isMe, false)))
    .groupBy(contacts.id)
    .orderBy(sql`last_email_at DESC`)
    .limit(limit + 1)
    .offset(offset)
    .all()

  const hasMore = unscreenedContacts.length > limit
  const items = hasMore ? unscreenedContacts.slice(0, limit) : unscreenedContacts

  return c.json({
    contacts: items.map(item => ({
      id: item.id,
      name: item.name,
      email: item.email,
      createdAt: item.createdAt,
      lastEmailAt: item.lastEmailAt ? new Date(item.lastEmailAt * 1000) : null,
      emailCount: item.emailCount || 0,
    })),
    hasMore,
  })
})

// PATCH /api/screener/:id
miscRoutes.patch('/screener/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid contact ID' }, 400)
  }

  const body = await c.req.json()
  const bucket = body?.bucket

  const validBuckets = ['approved', 'feed', 'paper_trail', 'blocked', 'quarantine']
  if (!validBuckets.includes(bucket)) {
    return c.json({ error: `Invalid bucket. Must be one of: ${validBuckets.join(', ')}` }, 400)
  }

  db.update(contacts)
    .set({ bucket })
    .where(eq(contacts.id, id))
    .run()

  return c.json({ success: true, id, bucket })
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
// Returns unread emails from approved senders for notifications
miscRoutes.get('/notifications/pending', async (c) => {
  // Get unread emails from approved threads (thread creator is approved or isMe)
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
    .innerJoin(
      db.select({ id: contacts.id, bucket: contacts.bucket, isMe: contacts.isMe })
        .from(contacts)
        .as('creator'),
      sql`creator.id = ${emailThreads.creatorId}`
    )
    .where(and(
      isNull(emails.readAt),
      eq(contacts.isMe, false), // Don't notify for own emails
      sql`(creator.bucket = 'approved' OR creator.is_me = 1)`
    ))
    .orderBy(desc(emails.sentAt))
    .limit(50)
    .all()

  // Get unread counts for digest
  const feedUnread = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emails)
    .innerJoin(contacts, eq(contacts.id, emails.senderId))
    .where(and(eq(contacts.bucket, 'feed'), isNull(emails.readAt)))
    .get()

  const paperTrailUnread = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emails)
    .innerJoin(contacts, eq(contacts.id, emails.senderId))
    .where(and(eq(contacts.bucket, 'paper_trail'), isNull(emails.readAt)))
    .get()

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
    feedUnread: feedUnread?.count || 0,
    paperTrailUnread: paperTrailUnread?.count || 0,
  })
})

// GET /api/unread-counts
miscRoutes.get('/unread-counts', async (c) => {
  const inboxUnread = db
    .select({ count: sql<number>`COUNT(DISTINCT ${emailThreads.id})` })
    .from(emailThreads)
    .innerJoin(emails, eq(emails.threadId, emailThreads.id))
    .innerJoin(contacts, eq(contacts.id, emails.senderId))
    .where(and(eq(contacts.bucket, 'approved'), isNull(emails.readAt)))
    .get()

  const feedUnread = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emails)
    .innerJoin(contacts, eq(contacts.id, emails.senderId))
    .where(and(eq(contacts.bucket, 'feed'), isNull(emails.readAt)))
    .get()

  const paperTrailUnread = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emails)
    .innerJoin(contacts, eq(contacts.id, emails.senderId))
    .where(and(eq(contacts.bucket, 'paper_trail'), isNull(emails.readAt)))
    .get()

  const quarantineUnread = db
    .select({ count: sql<number>`COUNT(DISTINCT ${emailThreads.id})` })
    .from(emailThreads)
    .innerJoin(emails, eq(emails.threadId, emailThreads.id))
    .innerJoin(contacts, eq(contacts.id, emails.senderId))
    .where(and(eq(contacts.bucket, 'quarantine'), isNull(emails.readAt)))
    .get()

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
    inbox: inboxUnread?.count || 0,
    feed: feedUnread?.count || 0,
    paper_trail: paperTrailUnread?.count || 0,
    quarantine: quarantineUnread?.count || 0,
    reply_later: replyLaterCount?.count || 0,
    set_aside: setAsideCount?.count || 0,
  })
})
