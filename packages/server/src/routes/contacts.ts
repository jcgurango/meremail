import { Hono } from 'hono'
import { eq, sql, asc, isNull, and, gt, desc, inArray } from 'drizzle-orm'
import { db, sqlite, contacts, emails, emailContacts, emailThreads, attachments } from '@meremail/shared'
import { proxyImagesInHtml } from '../utils/proxy-images'
import { replaceCidReferences } from '../utils/replace-cid'

export const contactsRoutes = new Hono()

// GET /api/contacts
contactsRoutes.get('/', async (c) => {
  const limit = Math.min(Number(c.req.query('limit')) || 50, 5000)
  const offset = Number(c.req.query('offset')) || 0
  const view = c.req.query('view') || 'approved'
  const q = (c.req.query('q') || '').trim()
  const isMe = c.req.query('isMe') === 'true'
  const includeCounts = c.req.query('counts') === 'true'
  const exportAll = c.req.query('all') === 'true'
  const createdSince = c.req.query('createdSince') ? Number(c.req.query('createdSince')) : null

  const hasSearchTerm = q.length >= 2
  // Escape FTS5 special characters: quotes, wildcards, parens, @ (column filter), - (NOT), + (required)
  const searchTerm = hasSearchTerm ? q.replace(/['"*()@\-+]/g, ' ').trim() + '*' : ''

  let contactsResult: any[]

  // Bulk export all contacts
  if (exportAll) {
    const baseQuery = db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        bucket: contacts.bucket,
        isMe: contacts.isMe,
        createdAt: contacts.createdAt,
      })
      .from(contacts)

    const results = createdSince
      ? baseQuery
          .where(gt(contacts.createdAt, new Date(createdSince)))
          .orderBy(asc(contacts.createdAt))
          .limit(limit)
          .all()
      : baseQuery
          .orderBy(asc(contacts.email))
          .limit(limit)
          .all()

    const maxCreatedAt = results.length > 0
      ? Math.max(...results.map(r => r.createdAt.getTime()))
      : createdSince || Date.now()

    return c.json({
      contacts: results.map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        bucket: r.bucket,
        isMe: !!r.isMe,
        createdAt: r.createdAt.getTime(),
      })),
      syncedAt: maxCreatedAt,
      hasMore: results.length === limit,
    })
  }

  // "Me" contacts
  if (isMe) {
    const results = db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        bucket: contacts.bucket,
        isMe: contacts.isMe,
      })
      .from(contacts)
      .where(eq(contacts.isMe, true))
      .orderBy(asc(contacts.name))
      .limit(limit)
      .offset(offset)
      .all()

    return c.json({
      contacts: results.map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        bucket: r.bucket,
        isMe: !!r.isMe,
      })),
      hasMore: false,
    })
  }

  if (hasSearchTerm) {
    let contactSql = `
      SELECT
        c.id,
        c.name,
        c.email,
        c.bucket,
        c.is_me as isMe,
        (SELECT COUNT(DISTINCT ec.email_id) FROM email_contacts ec WHERE ec.contact_id = c.id) as emailCount,
        (SELECT MAX(e.sent_at) FROM emails e JOIN email_contacts ec ON e.id = ec.email_id WHERE ec.contact_id = c.id) as lastEmailAt
      FROM contacts_fts
      JOIN contacts c ON contacts_fts.rowid = c.id
      WHERE contacts_fts MATCH ?`

    if (view === 'screener') {
      contactSql += ` AND c.bucket IS NULL AND c.is_me = 0`
    } else if (view === 'all') {
      contactSql += ` AND c.is_me = 0`
    } else {
      contactSql += ` AND c.bucket = '${view}' AND c.is_me = 0`
    }

    contactSql += ` ORDER BY rank, c.name COLLATE NOCASE ASC, c.email COLLATE NOCASE ASC
      LIMIT ? OFFSET ?`

    contactsResult = sqlite.prepare(contactSql).all(searchTerm, limit + 1, offset) as any[]
  } else if (view === 'screener') {
    const results = db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        bucket: contacts.bucket,
        isMe: contacts.isMe,
        lastEmailAt: sql<number>`MAX(${emails.sentAt})`.as('last_email_at'),
        emailCount: sql<number>`COUNT(DISTINCT ${emails.id})`.as('email_count'),
      })
      .from(contacts)
      .leftJoin(emailContacts, eq(contacts.id, emailContacts.contactId))
      .leftJoin(emails, eq(emailContacts.emailId, emails.id))
      .where(and(
        isNull(contacts.bucket),
        eq(contacts.isMe, false)
      ))
      .groupBy(contacts.id)
      .orderBy(sql`last_email_at DESC`)
      .limit(limit + 1)
      .offset(offset)
      .all()

    contactsResult = results.map(r => ({
      id: r.id,
      name: r.name,
      email: r.email,
      bucket: r.bucket,
      isMe: r.isMe,
      emailCount: r.emailCount,
      lastEmailAt: r.lastEmailAt,
    }))
  } else {
    const bucketToFilter = (view === 'contacts' ? 'approved' : view) as 'approved' | 'feed' | 'paper_trail' | 'quarantine' | 'blocked'
    const bucketFilter = and(eq(contacts.isMe, false), eq(contacts.bucket, bucketToFilter))

    const results = db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        bucket: contacts.bucket,
        isMe: contacts.isMe,
        lastEmailAt: sql<number>`MAX(${emails.sentAt})`.as('last_email_at'),
        emailCount: sql<number>`COUNT(DISTINCT ${emails.id})`.as('email_count'),
      })
      .from(contacts)
      .leftJoin(emailContacts, eq(contacts.id, emailContacts.contactId))
      .leftJoin(emails, eq(emailContacts.emailId, emails.id))
      .where(bucketFilter)
      .groupBy(contacts.id)
      .orderBy(sql`COALESCE(${contacts.name}, ${contacts.email}) COLLATE NOCASE ASC`)
      .limit(limit + 1)
      .offset(offset)
      .all()

    contactsResult = results.map(r => ({
      id: r.id,
      name: r.name,
      email: r.email,
      bucket: r.bucket,
      isMe: r.isMe,
      emailCount: r.emailCount,
      lastEmailAt: r.lastEmailAt,
    }))
  }

  const hasMore = contactsResult.length > limit
  const items = contactsResult.slice(0, limit)

  const response: {
    contacts: any[]
    hasMore: boolean
    counts?: Record<string, number>
  } = {
    contacts: items.map(item => ({
      id: item.id,
      name: item.name,
      email: item.email,
      bucket: item.bucket,
      isMe: !!item.isMe,
      lastEmailAt: item.lastEmailAt ? new Date(item.lastEmailAt * 1000) : null,
      emailCount: item.emailCount || 0,
    })),
    hasMore,
  }

  if (includeCounts) {
    const bucketCounts = db
      .select({
        bucket: contacts.bucket,
        count: sql<number>`COUNT(*)`.as('count'),
      })
      .from(contacts)
      .where(eq(contacts.isMe, false))
      .groupBy(contacts.bucket)
      .all()

    const counts: Record<string, number> = {
      unsorted: 0,
      approved: 0,
      feed: 0,
      paper_trail: 0,
      blocked: 0,
      quarantine: 0,
    }

    for (const { bucket, count } of bucketCounts) {
      if (bucket === null) {
        counts.unsorted = count
      } else {
        counts[bucket] = count
      }
    }

    response.counts = counts
  }

  return c.json(response)
})

// GET /api/contacts/me
contactsRoutes.get('/me', async (c) => {
  const results = db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
    })
    .from(contacts)
    .where(eq(contacts.isMe, true))
    .orderBy(asc(contacts.email))
    .all()

  return c.json({ contacts: results })
})

// GET /api/contacts/:id
contactsRoutes.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid contact ID' }, 400)
  }

  const limit = Math.min(Number(c.req.query('limit')) || 20, 50)
  const offset = Number(c.req.query('offset')) || 0

  const contact = db
    .select()
    .from(contacts)
    .where(eq(contacts.id, id))
    .get()

  if (!contact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  // "Me" contacts would include every thread - not useful and very slow
  if (contact.isMe) {
    return c.json({
      contact: {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        bucket: contact.bucket,
        isMe: contact.isMe,
      },
      threads: [],
      totalThreads: 0,
      hasMore: false,
      isMe: true,
    })
  }

  // Get thread IDs that have emails involving this contact
  const threadResults = sqlite.prepare(`
    WITH contact_emails AS (
      SELECT id, thread_id, sent_at
      FROM emails
      WHERE sender_id = ?
      UNION
      SELECT e.id, e.thread_id, e.sent_at
      FROM emails e
      INNER JOIN email_contacts ec ON e.id = ec.email_id
      WHERE ec.contact_id = ?
    ),
    thread_summary AS (
      SELECT thread_id as threadId, MAX(sent_at) as latestEmailAt
      FROM contact_emails
      GROUP BY thread_id
    )
    SELECT
      threadId,
      latestEmailAt,
      (SELECT COUNT(*) FROM thread_summary) as totalCount
    FROM thread_summary
    ORDER BY latestEmailAt DESC
    LIMIT ?
    OFFSET ?
  `).all(id, id, limit + 1, offset) as { threadId: number; latestEmailAt: number; totalCount: number }[]

  const totalThreads = threadResults[0]?.totalCount || 0
  const hasMore = threadResults.length > limit
  const threadIds = threadResults.slice(0, limit).map(t => t.threadId).filter(t => t !== null)

  if (threadIds.length === 0) {
    return c.json({
      contact: {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        bucket: contact.bucket,
        isMe: contact.isMe,
      },
      threads: [],
      totalThreads: 0,
      hasMore: false,
    })
  }

  // Get thread info
  const threads = db
    .select()
    .from(emailThreads)
    .where(inArray(emailThreads.id, threadIds))
    .all()

  const threadMap = new Map(threads.map(t => [t.id, t]))

  // Get all emails from these threads where the contact is involved
  const placeholders = threadIds.map(() => '?').join(', ')
  const emailResults = sqlite.prepare(`
    SELECT DISTINCT
      e.id, e.thread_id as threadId, e.subject, e.content_text as contentText,
      e.content_html as contentHtml, e.sent_at as sentAt, e.received_at as receivedAt,
      e.sender_id as senderId, e.read_at as readAt
    FROM emails e
    LEFT JOIN email_contacts ec ON e.id = ec.email_id
    WHERE e.thread_id IN (${placeholders})
      AND (e.sender_id = ? OR ec.contact_id = ?)
    ORDER BY e.sent_at DESC
  `).all(...threadIds, id, id) as any[]

  // Get all senders
  const senderIds = [...new Set(emailResults.map(e => e.senderId).filter(Boolean))] as number[]
  const senders = senderIds.length > 0
    ? db.select({ id: contacts.id, name: contacts.name, email: contacts.email, isMe: contacts.isMe })
        .from(contacts)
        .where(inArray(contacts.id, senderIds))
        .all()
    : []
  const senderMap = new Map(senders.map(s => [s.id, s]))

  // Get recipients for all emails
  const emailIds = emailResults.map(e => e.id)
  const recipientResults = emailIds.length > 0
    ? db.select({
        emailId: emailContacts.emailId,
        contactId: emailContacts.contactId,
        role: emailContacts.role,
        name: contacts.name,
        email: contacts.email,
        isMe: contacts.isMe,
      })
      .from(emailContacts)
      .innerJoin(contacts, eq(emailContacts.contactId, contacts.id))
      .where(inArray(emailContacts.emailId, emailIds))
      .all()
    : []

  // Group recipients by email
  const recipientsByEmail = new Map<number, typeof recipientResults>()
  for (const r of recipientResults) {
    if (!recipientsByEmail.has(r.emailId)) {
      recipientsByEmail.set(r.emailId, [])
    }
    recipientsByEmail.get(r.emailId)!.push(r)
  }

  // Get attachments for all emails (non-inline only)
  const attachmentResults = emailIds.length > 0
    ? db.select()
        .from(attachments)
        .where(and(inArray(attachments.emailId, emailIds), eq(attachments.isInline, false)))
        .all()
    : []

  const attachmentsByEmail = new Map<number, typeof attachmentResults>()
  for (const a of attachmentResults) {
    if (!attachmentsByEmail.has(a.emailId)) {
      attachmentsByEmail.set(a.emailId, [])
    }
    attachmentsByEmail.get(a.emailId)!.push(a)
  }

  // Group emails by thread
  const emailsByThread = new Map<number, typeof emailResults>()
  for (const email of emailResults) {
    if (email.threadId === null) continue
    if (!emailsByThread.has(email.threadId)) {
      emailsByThread.set(email.threadId, [])
    }
    emailsByThread.get(email.threadId)!.push(email)
  }

  // Build response, maintaining thread order
  const threadData = threadIds.map(threadId => {
    const thread = threadMap.get(threadId)
    if (!thread) return null
    const threadEmails = emailsByThread.get(threadId) || []

    return {
      id: thread.id,
      subject: thread.subject,
      emails: threadEmails.map(email => {
        const sender = email.senderId ? senderMap.get(email.senderId) : null
        const recipients = recipientsByEmail.get(email.id) || []
        const emailAttachments = attachmentsByEmail.get(email.id) || []

        let content = ''
        if (email.contentHtml) {
          const withCidReplaced = replaceCidReferences(email.contentHtml, email.id)
          content = proxyImagesInHtml(withCidReplaced)
        } else if (email.contentText) {
          content = `<pre style="white-space: pre-wrap; font-family: inherit;">${email.contentText}</pre>`
        }

        return {
          id: email.id,
          subject: email.subject,
          content,
          sentAt: new Date(email.sentAt * 1000),
          receivedAt: new Date(email.receivedAt * 1000),
          isRead: !!email.readAt,
          sender: sender ? {
            id: sender.id,
            name: sender.name,
            email: sender.email,
            isMe: sender.isMe,
          } : null,
          recipients: recipients.map(r => ({
            id: r.contactId,
            name: r.name,
            email: r.email,
            isMe: r.isMe,
            role: r.role,
          })),
          attachments: emailAttachments.map(a => ({
            id: a.id,
            filename: a.filename,
            mimeType: a.mimeType,
            size: a.size,
          })),
        }
      }),
    }
  }).filter(Boolean)

  return c.json({
    contact: {
      id: contact.id,
      name: contact.name,
      email: contact.email,
      bucket: contact.bucket,
      isMe: contact.isMe,
    },
    threads: threadData,
    totalThreads,
    hasMore,
  })
})
