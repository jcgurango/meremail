import { describe, it, expect, beforeAll } from 'vitest'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, sqlite, emails, contacts, attachments, deleteThreads } from '@meremail/shared'
import type { EmailSearchHit } from '@meremail/shared'
import { setupDatabase, receive, daysAgo, ME } from './helpers'
import { searchRoutes } from '../src/routes/search'

const app = new Hono()
app.route('/api/search', searchRoutes)

async function search(q: string, extra: Record<string, string> = {}): Promise<{ results: EmailSearchHit[]; hasMore: boolean }> {
  const params = new URLSearchParams({ type: 'email', q, ...extra })
  const res = await app.request(`/api/search?${params}`)
  expect(res.status).toBe(200)
  return res.json() as Promise<{ results: EmailSearchHit[]; hasMore: boolean }>
}

async function found(q: string, extra: Record<string, string> = {}): Promise<number[]> {
  return (await search(q, extra)).results.map(r => r.emailId!).sort((a, b) => a - b)
}

const BOB = { email: 'bob.builder@widgets.example', name: 'Bob Builder' }

let invoice: { id: number; threadId: number }
let lunch: { id: number; threadId: number }
let sent: { id: number; threadId: number }

beforeAll(async () => {
  setupDatabase()

  invoice = await receive({
    subject: 'Invoice 2041 for March',
    textContent: 'Please find the invoice attached. Payment is due within thirty days of receipt.',
    from: { email: 'billing@acme.example', name: 'Acme Billing' },
    cc: [BOB],
    sentAt: daysAgo(10),
    receivedAt: daysAgo(10),
    isRead: true,
  })
  lunch = await receive({
    subject: 'Lunch on Friday?',
    textContent: 'Fancy the new café by the station? I can book a table.',
    sentAt: daysAgo(3),
    receivedAt: daysAgo(3),
  })
  sent = await receive({
    subject: 'Quarterly report',
    textContent: 'Numbers for the quarter are in the spreadsheet.',
    from: ME,
    to: [BOB],
    isSent: true,
    isRead: true,
    sentAt: daysAgo(1),
    receivedAt: daysAgo(1),
  })
})

describe('email search', () => {
  it('finds mail by subject and body, matching whole words', async () => {
    expect(await found('invoice ')).toEqual([invoice.id])
    expect(await found('thirty days ')).toEqual([invoice.id])
    // Not part of a word...
    expect(await found('voice ')).toEqual([])
    // ...except for the word still being typed
    expect(await found('invo')).toEqual([invoice.id])
    expect(await found('invo ')).toEqual([])
  })

  it('requires every word, and phrases in order', async () => {
    expect(await found('invoice lunch ')).toEqual([])
    expect(await found('"due within"')).toEqual([invoice.id])
    expect(await found('"within due"')).toEqual([])
  })

  it('finds mail by sender and by recipient', async () => {
    expect(await found('acme ')).toEqual([invoice.id])
    expect(await found('from:billing@acme.example ')).toEqual([invoice.id])
    expect(await found('from:alice ')).toEqual([lunch.id])
    expect(await found('to:bob ')).toEqual([invoice.id, sent.id])
    expect(await found('to:widgets.example ')).toEqual([invoice.id, sent.id])
    expect(await found('from:bob ')).toEqual([])
    // Without an operator, people match wherever they appear
    expect(await found('builder ')).toEqual([invoice.id, sent.id])
  })

  it('limits a term to the subject', async () => {
    expect(await found('subject:invoice ')).toEqual([invoice.id])
    expect(await found('subject:payment ')).toEqual([])
  })

  it('ignores case and accents', async () => {
    expect(await found('CAFE ')).toEqual([lunch.id])
    expect(await found('café ')).toEqual([lunch.id])
  })

  it('filters by read state, folder and date', async () => {
    expect(await found('is:unread')).toEqual([lunch.id])
    expect(await found('', { unreadOnly: 'true' })).toEqual([lunch.id])
    expect(await found('in:inbox is:read')).toEqual([invoice.id, sent.id])
    expect(await found('in:junk is:read')).toEqual([])
    expect(await found('in:nowhere is:read')).toEqual([])

    const day = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    expect(await found(`after:${day(daysAgo(5))}`)).toEqual([lunch.id, sent.id])
    expect(await found(`before:${day(daysAgo(5))}`)).toEqual([invoice.id])
    // Both ends include the day named
    expect(await found(`after:${day(daysAgo(3))} before:${day(daysAgo(3))}`)).toEqual([lunch.id])
  })

  it('returns nothing for a query with no criteria', async () => {
    expect(await found('in:inbox')).toEqual([])
    expect(await found('')).toEqual([])
  })

  it('treats unknown operators and odd punctuation as text', async () => {
    expect(await found('due:within ')).toEqual([invoice.id])
    expect(await found('"(invoice) AND* ^2041" ')).toEqual([])
    expect(await found('NOT OR AND ')).toEqual([])
  })

  it('gives one result per thread, newest match first', async () => {
    const reply = await receive({
      subject: 'Re: Invoice 2041 for March',
      textContent: 'The invoice has been paid, thanks.',
      inReplyTo: (sqlite.prepare('SELECT message_id AS messageId FROM emails WHERE id = ?').get(invoice.id) as { messageId: string }).messageId,
      sentAt: daysAgo(2),
      receivedAt: daysAgo(2),
    })
    expect(reply.threadId).toBe(invoice.threadId)

    const { results } = await search('invoice ')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ emailId: reply.id, threadId: invoice.threadId, matches: 2, isRead: false })

    // Newest thread first by default
    const both = await search('the ')
    expect(both.results.map(r => r.threadId)).toEqual([sent.threadId, invoice.threadId, lunch.threadId])

    // Oldest first: threads by their oldest match
    const oldest = await search('the sort:oldest')
    expect(oldest.results.map(r => r.emailId)).toEqual([invoice.id, lunch.id, sent.id])
    expect(await found('sort:oldest')).toEqual([])
  })

  it('pages through threads', async () => {
    const first = await search('the ', { limit: '2' })
    expect(first.results).toHaveLength(2)
    expect(first.hasMore).toBe(true)
    const second = await search('the ', { limit: '2', offset: '2' })
    expect(second.results.map(r => r.threadId)).toEqual([lunch.threadId])
    expect(second.hasMore).toBe(false)
  })

  it('cuts the snippet around the match', async () => {
    const long = await receive({
      subject: 'Minutes',
      textContent: `${'Nothing of note was said. '.repeat(40)}Then the zeppelin arrived. ${'More filler followed. '.repeat(40)}`,
    })
    const { results } = await search('zeppelin ')
    expect(results[0]!.emailId).toBe(long.id)
    expect(results[0]!.snippet).toContain('zeppelin')
    expect(results[0]!.snippet.length).toBeLessThan(210)
    expect(results[0]!.snippet.startsWith('…')).toBe(true)
  })
})

describe('search index upkeep', () => {
  it('follows attachments being added and removed', async () => {
    expect(await found('filename:report.pdf ')).toEqual([])
    const [row] = db.insert(attachments).values([
      { emailId: sent.id, filename: 'Q3-report.pdf', mimeType: 'application/pdf', size: 10, filePath: 'none/Q3-report.pdf' },
      { emailId: sent.id, filename: 'logo.png', mimeType: 'image/png', size: 10, filePath: 'none/logo.png', isInline: true },
    ]).returning().all()

    expect(await found('filename:report.pdf ')).toEqual([sent.id])
    expect(await found('q3 ')).toEqual([sent.id])
    expect(await found('has:attachment')).toEqual([sent.id])
    // Inline images aren't attachments as far as search is concerned
    expect(await found('filename:logo ')).toEqual([])

    db.delete(attachments).where(eq(attachments.id, row!.id)).run()
    expect(await found('filename:report.pdf ')).toEqual([])
    expect(await found('has:attachment')).toEqual([])
    db.delete(attachments).where(eq(attachments.emailId, sent.id)).run()
  })

  it('follows edits to an email and renames of a contact', async () => {
    db.update(emails).set({ subject: 'Quarterly figures' }).where(eq(emails.id, sent.id)).run()
    expect(await found('subject:report ')).toEqual([])
    expect(await found('subject:figures ')).toEqual([sent.id])

    expect(await found('to:robert ')).toEqual([])
    db.update(contacts).set({ name: 'Robert Builder' }).where(eq(contacts.email, BOB.email)).run()
    expect(await found('to:robert ')).toEqual([invoice.id, sent.id].sort((a, b) => a - b))
    expect(await found('"bob builder widgets" ')).toEqual([invoice.id, sent.id].sort((a, b) => a - b)) // still the address
  })

  it('does not reindex when only read state changes', async () => {
    const before = sqlite.prepare('SELECT count(*) AS n FROM emails_fts').get() as { n: number }
    db.update(emails).set({ readAt: new Date() }).where(eq(emails.id, lunch.id)).run()
    expect(await found('lunch ')).toEqual([lunch.id])
    expect(sqlite.prepare('SELECT count(*) AS n FROM emails_fts').get()).toEqual(before)
  })

  it('forgets deleted mail', async () => {
    deleteThreads([lunch.threadId])
    expect(await found('lunch ')).toEqual([])
    const counts = sqlite.prepare('SELECT (SELECT count(*) FROM emails) AS emails, (SELECT count(*) FROM emails_fts) AS indexed').get() as { emails: number; indexed: number }
    expect(counts.indexed).toBe(counts.emails)
  })
})
