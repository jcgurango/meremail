import { db } from '../db'
import { contacts, emails, emailContacts } from '../db/schema'
import { eq, sql, asc, isNull, and } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 50, 100)
  const offset = Number(query.offset) || 0

  // Get contacts with their first email date, ordered by first email descending
  // Only show contacts that haven't been bucketed yet and aren't "me"
  const results = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
      bucket: contacts.bucket,
      firstEmailAt: sql<number>`MAX(${emails.sentAt})`.as('last_email_at'),
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

  const hasMore = results.length > limit
  const items = results.slice(0, limit)

  // Get counts for each bucket
  const bucketCounts = await db
    .select({
      bucket: contacts.bucket,
      count: sql<number>`COUNT(*)`.as('count'),
    })
    .from(contacts)
    .where(eq(contacts.isMe, false))
    .groupBy(contacts.bucket)

  const counts: Record<string, number> = {
    unsorted: 0,
    approved: 0,
    feed: 0,
    paper_trail: 0,
    blocked: 0,
  }

  for (const { bucket, count } of bucketCounts) {
    if (bucket === null) {
      counts.unsorted = count
    } else {
      counts[bucket] = count
    }
  }

  return {
    contacts: items.map(item => ({
      id: item.id,
      name: item.name,
      email: item.email,
      bucket: item.bucket,
      firstEmailAt: item.firstEmailAt ? new Date(item.firstEmailAt * 1000) : null,
      emailCount: item.emailCount,
    })),
    hasMore,
    counts,
  }
})
