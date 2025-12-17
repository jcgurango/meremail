import { Hono } from 'hono'
import { eq, sql, asc, and, gt, desc, inArray } from 'drizzle-orm'
import { db, sqlite, contacts, emails, emailContacts, emailThreads, attachments } from '@meremail/shared'
import { proxyImagesInHtml } from '../utils/proxy-images'
import { replaceCidReferences } from '../utils/replace-cid'

export const contactsRoutes = new Hono()

// GET /api/contacts
contactsRoutes.get('/', async (c) => {
  const limit = Math.min(Number(c.req.query('limit')) || 50, 5000)
  const offset = Number(c.req.query('offset')) || 0
  const q = (c.req.query('q') || '').trim()
  const isMe = c.req.query('isMe') === 'true'
  const exportAll = c.req.query('all') === 'true'
  const createdSince = c.req.query('createdSince') ? Number(c.req.query('createdSince')) : null

  const hasSearchTerm = q.length >= 2
  // Escape FTS5 special characters: quotes, wildcards, parens, @ (column filter), - (NOT), + (required), . and : (column filter syntax), ^ (initial token)
  const searchTerm = hasSearchTerm ? q.replace(/['"*()@\-+.:^]/g, ' ').trim() + '*' : ''

  let contactsResult: any[]

  // Bulk export all contacts
  if (exportAll) {
    const baseQuery = db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
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
        isMe: !!r.isMe,
        createdAt: r.createdAt.getTime(),
      })),
      syncedAt: maxCreatedAt,
      hasMore: results.length === limit,
    })
  }

  // "Me" contacts (identities)
  if (isMe) {
    let identityResults: any[]

    if (hasSearchTerm) {
      // Use FTS for search, filtered to isMe contacts
      const identitySql = `
        SELECT
          c.id,
          c.name,
          c.email,
          c.is_me as isMe,
          c.is_default_identity as isDefaultIdentity,
          (SELECT COUNT(DISTINCT ec.email_id) FROM email_contacts ec WHERE ec.contact_id = c.id) as emailCount,
          (SELECT MAX(e.sent_at) FROM emails e JOIN email_contacts ec ON e.id = ec.email_id WHERE ec.contact_id = c.id) as lastEmailAt
        FROM contacts_fts
        JOIN contacts c ON contacts_fts.rowid = c.id
        WHERE contacts_fts MATCH ? AND c.is_me = 1
        ORDER BY c.is_default_identity DESC, COALESCE(c.name, c.email) COLLATE NOCASE ASC
        LIMIT ? OFFSET ?`

      identityResults = sqlite.prepare(identitySql).all(searchTerm, limit + 1, offset) as any[]
    } else {
      const results = db
        .select({
          id: contacts.id,
          name: contacts.name,
          email: contacts.email,
          isMe: contacts.isMe,
          isDefaultIdentity: contacts.isDefaultIdentity,
          lastEmailAt: sql<number>`MAX(${emails.sentAt})`.as('last_email_at'),
          emailCount: sql<number>`COUNT(DISTINCT ${emails.id})`.as('email_count'),
        })
        .from(contacts)
        .leftJoin(emailContacts, eq(contacts.id, emailContacts.contactId))
        .leftJoin(emails, eq(emailContacts.emailId, emails.id))
        .where(eq(contacts.isMe, true))
        .groupBy(contacts.id)
        .orderBy(desc(contacts.isDefaultIdentity), sql`COALESCE(${contacts.name}, ${contacts.email}) COLLATE NOCASE ASC`)
        .limit(limit + 1)
        .offset(offset)
        .all()

      identityResults = results.map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        isMe: r.isMe,
        isDefaultIdentity: r.isDefaultIdentity,
        emailCount: r.emailCount,
        lastEmailAt: r.lastEmailAt,
      }))
    }

    const hasMore = identityResults.length > limit
    const items = identityResults.slice(0, limit)

    return c.json({
      contacts: items.map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        isMe: !!r.isMe,
        isDefaultIdentity: !!r.isDefaultIdentity,
        lastEmailAt: r.lastEmailAt ? new Date(r.lastEmailAt * 1000) : null,
        emailCount: r.emailCount || 0,
      })),
      hasMore,
    })
  }

  if (hasSearchTerm) {
    const contactSql = `
      SELECT
        c.id,
        c.name,
        c.email,
        c.is_me as isMe,
        (SELECT COUNT(DISTINCT ec.email_id) FROM email_contacts ec WHERE ec.contact_id = c.id) as emailCount,
        (SELECT MAX(e.sent_at) FROM emails e JOIN email_contacts ec ON e.id = ec.email_id WHERE ec.contact_id = c.id) as lastEmailAt
      FROM contacts_fts
      JOIN contacts c ON contacts_fts.rowid = c.id
      WHERE contacts_fts MATCH ? AND c.is_me = 0
      ORDER BY rank, c.name COLLATE NOCASE ASC, c.email COLLATE NOCASE ASC
      LIMIT ? OFFSET ?`

    contactsResult = sqlite.prepare(contactSql).all(searchTerm, limit + 1, offset) as any[]
  } else {
    const results = db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        isMe: contacts.isMe,
        lastEmailAt: sql<number>`MAX(${emails.sentAt})`.as('last_email_at'),
        emailCount: sql<number>`COUNT(DISTINCT ${emails.id})`.as('email_count'),
      })
      .from(contacts)
      .leftJoin(emailContacts, eq(contacts.id, emailContacts.contactId))
      .leftJoin(emails, eq(emailContacts.emailId, emails.id))
      .where(eq(contacts.isMe, false))
      .groupBy(contacts.id)
      .orderBy(sql`COALESCE(${contacts.name}, ${contacts.email}) COLLATE NOCASE ASC`)
      .limit(limit + 1)
      .offset(offset)
      .all()

    contactsResult = results.map(r => ({
      id: r.id,
      name: r.name,
      email: r.email,
      isMe: r.isMe,
      emailCount: r.emailCount,
      lastEmailAt: r.lastEmailAt,
    }))
  }

  const hasMore = contactsResult.length > limit
  const items = contactsResult.slice(0, limit)

  return c.json({
    contacts: items.map(item => ({
      id: item.id,
      name: item.name,
      email: item.email,
      isMe: !!item.isMe,
      lastEmailAt: item.lastEmailAt ? new Date(item.lastEmailAt * 1000) : null,
      emailCount: item.emailCount || 0,
    })),
    hasMore,
  })
})

// GET /api/contacts/me
contactsRoutes.get('/me', async (c) => {
  const results = db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
      isDefaultIdentity: contacts.isDefaultIdentity,
    })
    .from(contacts)
    .where(eq(contacts.isMe, true))
    .orderBy(desc(contacts.isDefaultIdentity), asc(contacts.email))
    .all()

  return c.json({
    contacts: results.map(r => ({
      id: r.id,
      name: r.name,
      email: r.email,
      isDefaultIdentity: !!r.isDefaultIdentity,
    })),
  })
})

// POST /api/contacts/:id/set-default-identity
contactsRoutes.post('/:id/set-default-identity', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid contact ID' }, 400)
  }

  const contact = db
    .select()
    .from(contacts)
    .where(eq(contacts.id, id))
    .get()

  if (!contact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  if (!contact.isMe) {
    return c.json({ error: 'Only identities can be set as default' }, 400)
  }

  // Clear existing default
  db.update(contacts)
    .set({ isDefaultIdentity: false })
    .where(eq(contacts.isDefaultIdentity, true))
    .run()

  // Set new default
  db.update(contacts)
    .set({ isDefaultIdentity: true })
    .where(eq(contacts.id, id))
    .run()

  return c.json({ success: true })
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
      isMe: contact.isMe,
    },
    threads: threadData,
    totalThreads,
    hasMore,
  })
})

// PATCH /api/contacts/:id - Update contact
contactsRoutes.patch('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid contact ID' }, 400)
  }

  const contact = db
    .select()
    .from(contacts)
    .where(eq(contacts.id, id))
    .get()

  if (!contact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  const body = await c.req.json()

  // Only allow updating name for now
  if (body.name !== undefined) {
    db.update(contacts)
      .set({ name: body.name || null })
      .where(eq(contacts.id, id))
      .run()
  }

  const updated = db
    .select()
    .from(contacts)
    .where(eq(contacts.id, id))
    .get()

  return c.json({
    contact: {
      id: updated!.id,
      name: updated!.name,
      email: updated!.email,
      isMe: updated!.isMe,
    },
  })
})
