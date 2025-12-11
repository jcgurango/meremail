import { db } from '../db'
import { contacts, emails, emailContacts } from '../db/schema'
import { eq, sql, asc, isNull, and, ne } from 'drizzle-orm'
import { sqlite } from '../db'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 50, 100)
  const offset = Number(query.offset) || 0
  const view = (query.view as string) || 'all' // 'all' or 'screener'
  const q = (query.q as string || '').trim()

  // For search, use FTS
  const hasSearchTerm = q.length >= 2
  const searchTerm = hasSearchTerm ? q.replace(/['"*()]/g, ' ').trim() + '*' : ''

  let contactsResult: any[]

  if (hasSearchTerm) {
    // FTS search for contacts - respect view filter
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

    // Filter by view
    if (view === 'screener') {
      contactSql += ` AND c.bucket IS NULL AND c.is_me = 0`
    } else if (view === 'contacts') {
      // 'contacts' view shows approved contacts
      contactSql += ` AND c.bucket = 'approved' AND c.is_me = 0`
    } else {
      // Specific bucket filter (approved, feed, paper_trail, etc.)
      contactSql += ` AND c.bucket = '${view}' AND c.is_me = 0`
    }

    contactSql += ` ORDER BY rank, c.name COLLATE NOCASE ASC, c.email COLLATE NOCASE ASC
      LIMIT ? OFFSET ?`

    contactsResult = sqlite.prepare(contactSql).all(searchTerm, limit + 1, offset) as any[]
  } else if (view === 'screener') {
    // Screener view: unscreened contacts only, ordered by last email date
    const results = await db
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
    // 'contacts' view shows approved contacts (default)
    // Other views filter to specific bucket
    const bucketToFilter = view === 'contacts' ? 'approved' : view
    const bucketFilter = and(eq(contacts.isMe, false), eq(contacts.bucket, bucketToFilter))

    const results = await db
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
    quarantine: 0,
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
      isMe: !!item.isMe,
      lastEmailAt: item.lastEmailAt ? new Date(item.lastEmailAt * 1000) : null,
      emailCount: item.emailCount || 0,
    })),
    hasMore,
    counts,
  }
})
