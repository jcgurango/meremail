import { eq, desc, asc, sql, and, inArray, isNotNull } from 'drizzle-orm'
import { db } from '../db'
import { emails, emailThreads, contacts, emailThreadContacts } from '../db/schema'

// Strip HTML tags and decode entities for plain text snippets
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')  // Remove <style> blocks entirely
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove <script> blocks entirely
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')    // Remove <head> blocks entirely
    .replace(/<[^>]*>/g, ' ')           // Remove remaining HTML tags
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
  const limit = Math.min(parseInt(query.limit as string) || 25, 100)
  const offset = parseInt(query.offset as string) || 0
  const bucket = (query.bucket as string) || 'approved' // Filter by creator's bucket
  const replyLater = query.replyLater === 'true' // Filter for reply later queue

  // Build where clause and order based on filter type
  let whereClause
  let orderByClause

  if (replyLater) {
    // Reply Later queue: show all threads with replyLaterAt set, sorted by oldest addition first
    whereClause = isNotNull(emailThreads.replyLaterAt)
    orderByClause = [
      asc(emailThreads.replyLaterAt),  // Oldest addition first
      desc(sql`sort_date`)  // Then by sort date
    ]
  } else if (bucket === 'approved') {
    // Filter: thread creator must match bucket or is "me"
    whereClause = sql`${contacts.bucket} = 'approved' OR ${contacts.isMe} = 1`
    orderByClause = [
      desc(sql`CASE WHEN unread_count > 0 THEN 1 ELSE 0 END`),  // Unread threads first
      desc(sql`sort_date`)  // Then by MAX(highest readAt, latest sentAt)
    ]
  } else {
    whereClause = sql`${contacts.bucket} = ${bucket}`
    orderByClause = [
      desc(sql`CASE WHEN unread_count > 0 THEN 1 ELSE 0 END`),
      desc(sql`sort_date`)
    ]
  }

  // Get all threads, ordered by: unread first, then by sort_date
  // sort_date = MAX(highest readAt in thread, latest email sentAt) - so newly read threads bubble up
  // Filter by thread creator (sender of first email) - must match specified bucket or "me"
  // Uses denormalized creator_id on email_threads for O(n) instead of O(n²)
  const threadsWithUnread = db
    .select({
      id: emailThreads.id,
      subject: emailThreads.subject,
      createdAt: emailThreads.createdAt,
      replyLaterAt: emailThreads.replyLaterAt,
      setAsideAt: emailThreads.setAsideAt,
      latestEmailAt: sql<number>`MAX(${emails.sentAt})`.as('latest_email_at'),
      // sort_date: MAX of (highest readAt, latest sentAt) - for intuitive sorting
      sortDate: sql<number>`MAX(COALESCE(${emails.readAt}, 0), ${emails.sentAt})`.as('sort_date'),
      unreadCount: sql<number>`SUM(CASE WHEN ${emails.readAt} IS NULL THEN 1 ELSE 0 END)`.as('unread_count'),
      totalCount: sql<number>`COUNT(${emails.id})`.as('total_count'),
    })
    .from(emailThreads)
    .innerJoin(emails, eq(emails.threadId, emailThreads.id))
    .innerJoin(contacts, eq(contacts.id, emailThreads.creatorId))
    .where(whereClause)
    .groupBy(emailThreads.id)
    .orderBy(...orderByClause)
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

    // Get snippet from latest email not from us - prefer text, fall back to stripped HTML
    const latestEmail = db
      .select({
        contentText: emails.contentText,
        contentHtml: emails.contentHtml,
      })
      .from(emails)
      .innerJoin(contacts, eq(contacts.id, emails.senderId))
      .where(and(
        eq(emails.threadId, thread.id),
        eq(contacts.isMe, false)
      ))
      .orderBy(desc(emails.sentAt))
      .limit(1)
      .get()

    let snippet = ''
    if (latestEmail) {
      const text = latestEmail.contentText || ''
      // Check if text looks like CSS (common patterns)
      const looksLikeCss = /\{[^}]*:[^}]*\}|@media|@font-face|\.[\w-]+\s*\{/i.test(text.substring(0, 500))
      if (text && !looksLikeCss) {
        snippet = text.substring(0, 150)
      } else {
        snippet = stripHtml(latestEmail.contentHtml || '').substring(0, 150)
      }
    }

    return {
      ...thread,
      // Raw SQL MAX() returns seconds, need to convert to milliseconds for Date
      latestEmailAt: thread.latestEmailAt ? new Date(thread.latestEmailAt * 1000) : null,
      participants: participants.filter((p) => !p.isMe),
      snippet,
    }
  })

  return {
    threads: threadsWithParticipants,
    hasMore,
  }
})
