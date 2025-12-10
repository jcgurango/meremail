import { eq, desc, sql, and } from 'drizzle-orm'
import { db } from '../db'
import { emails, emailThreads, contacts, emailThreadContacts } from '../db/schema'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const unreadOnly = query.unreadOnly !== 'false'

  // Get threads with unread emails, ordered by latest email date
  const threadsWithUnread = db
    .select({
      id: emailThreads.id,
      subject: emailThreads.subject,
      createdAt: emailThreads.createdAt,
      latestEmailAt: sql<number>`MAX(${emails.sentAt})`.as('latest_email_at'),
      unreadCount: sql<number>`SUM(CASE WHEN ${emails.isRead} = 0 THEN 1 ELSE 0 END)`.as('unread_count'),
      totalCount: sql<number>`COUNT(${emails.id})`.as('total_count'),
    })
    .from(emailThreads)
    .innerJoin(emails, eq(emails.threadId, emailThreads.id))
    .groupBy(emailThreads.id)
    .having(unreadOnly ? sql`unread_count > 0` : sql`1=1`)
    .orderBy(desc(sql`latest_email_at`))
    .all()

  // Get participants for each thread
  const threadsWithParticipants = threadsWithUnread.map((thread) => {
    const participants = db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        isMe: contacts.isMe,
        role: emailThreadContacts.role,
      })
      .from(emailThreadContacts)
      .innerJoin(contacts, eq(contacts.id, emailThreadContacts.contactId))
      .where(eq(emailThreadContacts.threadId, thread.id))
      .all()

    // Get snippet from latest email
    const latestEmail = db
      .select({
        content: emails.content,
        senderId: emails.senderId,
      })
      .from(emails)
      .where(eq(emails.threadId, thread.id))
      .orderBy(desc(emails.sentAt))
      .limit(1)
      .get()

    const snippet = latestEmail?.content
      ? latestEmail.content.substring(0, 150).replace(/\s+/g, ' ').trim()
      : ''

    return {
      ...thread,
      latestEmailAt: thread.latestEmailAt ? new Date(thread.latestEmailAt * 1000) : null,
      participants: participants.filter((p) => !p.isMe),
      snippet,
    }
  })

  return threadsWithParticipants
})
