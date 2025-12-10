import { eq, desc, sql, and } from 'drizzle-orm'
import { db } from '../db'
import { emails, emailThreads, contacts, emailThreadContacts } from '../db/schema'

// Strip HTML tags and decode entities for plain text snippets
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')           // Remove HTML tags
    .replace(/&nbsp;/gi, ' ')            // Decode &nbsp;
    .replace(/&amp;/gi, '&')             // Decode &amp;
    .replace(/&lt;/gi, '<')              // Decode &lt;
    .replace(/&gt;/gi, '>')              // Decode &gt;
    .replace(/&quot;/gi, '"')            // Decode &quot;
    .replace(/&#\d+;/g, '')              // Remove numeric entities
    .replace(/\s+/g, ' ')                // Collapse whitespace
    .trim()
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const unreadOnly = query.unreadOnly !== 'false'
  const limit = Math.min(parseInt(query.limit as string) || 25, 100)
  const offset = parseInt(query.offset as string) || 0

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
    .limit(limit + 1)  // Fetch one extra to check if there's more
    .offset(offset)
    .all()

  const hasMore = threadsWithUnread.length > limit
  const threads = hasMore ? threadsWithUnread.slice(0, limit) : threadsWithUnread

  // Get participants for each thread
  const threadsWithParticipants = threads.map((thread) => {
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

    // Get snippet from latest email - prefer text, fall back to stripped HTML
    const latestEmail = db
      .select({
        contentText: emails.contentText,
        contentHtml: emails.contentHtml,
      })
      .from(emails)
      .where(eq(emails.threadId, thread.id))
      .orderBy(desc(emails.sentAt))
      .limit(1)
      .get()

    const snippet = latestEmail
      ? (latestEmail.contentText || stripHtml(latestEmail.contentHtml || '')).substring(0, 150)
      : ''

    return {
      ...thread,
      latestEmailAt: thread.latestEmailAt ? new Date(thread.latestEmailAt) : null,
      participants: participants.filter((p) => !p.isMe),
      snippet,
    }
  })

  return {
    threads: threadsWithParticipants,
    hasMore,
  }
})
