import { eq, and, sql, isNotNull } from 'drizzle-orm'
import { db } from '../db'
import { emails, contacts, emailThreads } from '../db/schema'

export default defineEventHandler(async () => {
  // Get unread counts per bucket
  // For 'approved' (inbox) and 'quarantine': count unread threads
  // For 'feed' and 'paper_trail': count unread emails from contacts in that bucket
  // For 'reply_later' and 'set_aside': count total threads (not unread-based)

  // Inbox (approved): unread thread count
  const inboxUnread = db
    .select({ count: sql<number>`COUNT(DISTINCT ${emailThreads.id})` })
    .from(emailThreads)
    .innerJoin(emails, eq(emails.threadId, emailThreads.id))
    .innerJoin(contacts, eq(contacts.id, emails.senderId))
    .where(and(
      eq(contacts.bucket, 'approved'),
      eq(emails.isRead, false)
    ))
    .get()

  // Feed: unread email count
  const feedUnread = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emails)
    .innerJoin(contacts, eq(contacts.id, emails.senderId))
    .where(and(
      eq(contacts.bucket, 'feed'),
      eq(emails.isRead, false)
    ))
    .get()

  // Paper Trail: unread email count
  const paperTrailUnread = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emails)
    .innerJoin(contacts, eq(contacts.id, emails.senderId))
    .where(and(
      eq(contacts.bucket, 'paper_trail'),
      eq(emails.isRead, false)
    ))
    .get()

  // Quarantine: unread thread count
  const quarantineUnread = db
    .select({ count: sql<number>`COUNT(DISTINCT ${emailThreads.id})` })
    .from(emailThreads)
    .innerJoin(emails, eq(emails.threadId, emailThreads.id))
    .innerJoin(contacts, eq(contacts.id, emails.senderId))
    .where(and(
      eq(contacts.bucket, 'quarantine'),
      eq(emails.isRead, false)
    ))
    .get()

  // Reply Later: total thread count (not unread-based)
  const replyLaterCount = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emailThreads)
    .where(isNotNull(emailThreads.replyLaterAt))
    .get()

  // Set Aside: total thread count (not unread-based)
  const setAsideCount = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emailThreads)
    .where(isNotNull(emailThreads.setAsideAt))
    .get()

  return {
    inbox: inboxUnread?.count || 0,
    feed: feedUnread?.count || 0,
    paper_trail: paperTrailUnread?.count || 0,
    quarantine: quarantineUnread?.count || 0,
    reply_later: replyLaterCount?.count || 0,
    set_aside: setAsideCount?.count || 0,
  }
})
