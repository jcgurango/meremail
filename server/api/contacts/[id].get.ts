import { db } from '../../db'
import { contacts, emails, emailContacts, emailThreads, attachments } from '../../db/schema'
import { eq, desc, sql, inArray } from 'drizzle-orm'
import { replaceCidReferences } from '../../utils/replace-cid'
import { proxyImagesInHtml } from '../../utils/proxy-images'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: 'Invalid contact ID' })
  }

  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 20, 50)
  const offset = Number(query.offset) || 0

  // Get the contact
  const contact = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, id))
    .get()

  if (!contact) {
    throw createError({ statusCode: 404, message: 'Contact not found' })
  }

  // "Me" contacts would include every thread - not useful and very slow
  if (contact.isMe) {
    return {
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
    }
  }

  // Get thread IDs that have emails involving this contact, ordered by most recent email
  // Use UNION instead of OR to allow index usage on both conditions
  // Use a CTE with subquery to get total count without a separate query
  const threadResults = db.all<{ threadId: number; latestEmailAt: number; totalCount: number }>(sql`
    WITH contact_emails AS (
      SELECT ${emails.id}, ${emails.threadId}, ${emails.sentAt}
      FROM ${emails}
      WHERE ${emails.senderId} = ${id}
      UNION
      SELECT ${emails.id}, ${emails.threadId}, ${emails.sentAt}
      FROM ${emails}
      INNER JOIN ${emailContacts} ON ${emails.id} = ${emailContacts.emailId}
      WHERE ${emailContacts.contactId} = ${id}
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
    LIMIT ${limit + 1}
    OFFSET ${offset}
  `)

  const totalThreads = threadResults[0]?.totalCount || 0
  const hasMore = threadResults.length > limit
  const threadIds = threadResults.slice(0, limit).map(t => t.threadId)

  if (threadIds.length === 0) {
    return {
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
    }
  }

  // Get thread info
  const threads = await db
    .select()
    .from(emailThreads)
    .where(inArray(emailThreads.id, threadIds))

  const threadMap = new Map(threads.map(t => [t.id, t]))

  // Get all emails from these threads where the contact is involved
  const emailResults = await db
    .selectDistinct({
      id: emails.id,
      threadId: emails.threadId,
      subject: emails.subject,
      contentText: emails.contentText,
      contentHtml: emails.contentHtml,
      sentAt: emails.sentAt,
      receivedAt: emails.receivedAt,
      senderId: emails.senderId,
      readAt: emails.readAt,
    })
    .from(emails)
    .leftJoin(emailContacts, eq(emails.id, emailContacts.emailId))
    .where(
      sql`${emails.threadId} IN (${sql.join(threadIds.map(id => sql`${id}`), sql`, `)})
      AND (${emails.senderId} = ${id} OR ${emailContacts.contactId} = ${id})`
    )
    .orderBy(desc(emails.sentAt))

  // Get all senders
  const senderIds = [...new Set(emailResults.map(e => e.senderId).filter(Boolean))] as number[]
  const senders = senderIds.length > 0
    ? await db
        .select({ id: contacts.id, name: contacts.name, email: contacts.email, isMe: contacts.isMe })
        .from(contacts)
        .where(inArray(contacts.id, senderIds))
    : []
  const senderMap = new Map(senders.map(s => [s.id, s]))

  // Get recipients for all emails
  const emailIds = emailResults.map(e => e.id)
  const recipientResults = emailIds.length > 0
    ? await db
        .select({
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
    ? await db
        .select()
        .from(attachments)
        .where(sql`${attachments.emailId} IN (${sql.join(emailIds.map(id => sql`${id}`), sql`, `)}) AND ${attachments.isInline} = 0`)
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
    if (!emailsByThread.has(email.threadId)) {
      emailsByThread.set(email.threadId, [])
    }
    emailsByThread.get(email.threadId)!.push(email)
  }

  // Build response, maintaining thread order
  const threadData = threadIds.map(threadId => {
    const thread = threadMap.get(threadId)!
    const threadEmails = emailsByThread.get(threadId) || []

    return {
      id: thread.id,
      subject: thread.subject,
      emails: threadEmails.map(email => {
        const sender = email.senderId ? senderMap.get(email.senderId) : null
        const recipients = recipientsByEmail.get(email.id) || []
        const emailAttachments = attachmentsByEmail.get(email.id) || []

        // Process content - replace CID references and proxy images (sanitization done client-side)
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
          sentAt: email.sentAt,
          receivedAt: email.receivedAt,
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
  })

  return {
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
  }
})
