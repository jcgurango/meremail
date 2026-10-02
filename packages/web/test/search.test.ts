import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseQuery,
  tokenizeQuery,
  hasCriteria,
  setOperator,
  matchesText,
  toFtsMatch,
  highlight,
  searchSnippet,
  type SearchDocument,
} from '@meremail/shared/search'
import { db } from '@/local/db'
import { storeThreads } from '@/local/store'
import { searchLocal, mergeResults, type EmailSearchResult } from '@/local/search'
import { resetDb, makeThread, makeEmail, FOLDERS, DAY, ME, ALICE } from './helpers'

const DOC: SearchDocument = {
  subject: 'Invoice 2041 for March',
  body: 'Please find the invoice attached.\nPayment is due at the Café.',
  sender: 'Acme Billing billing@acme.example',
  recipients: 'Me me@example.com\nBob Builder bob.builder@widgets.example',
  filenames: 'invoice-2041.pdf',
}

function matches(text: string, doc = DOC): boolean {
  return matchesText(doc, parseQuery(text))
}

describe('query language', () => {
  it('splits text into terms and operators', () => {
    const query = parseQuery('in:inbox from:"Acme Billing" has:attachment is:unread after:2026-01-31 until:2026-02-28 sort:oldest "due at" invoice ')
    expect(query).toEqual({
      terms: [
        { words: ['acme', 'billing'], prefix: false, field: 'sender' },
        { words: ['due', 'at'], prefix: false, field: null },
        { words: ['invoice'], prefix: false, field: null },
      ],
      folders: ['inbox'],
      hasAttachment: true,
      unread: true,
      after: '2026-01-31',
      before: '2026-02-28',
      sort: 'oldest',
    })
  })

  it('treats the word being typed as the start of a word', () => {
    expect(parseQuery('march inv').terms.map(t => t.prefix)).toEqual([false, true])
    expect(parseQuery('march inv ').terms.map(t => t.prefix)).toEqual([false, false])
    expect(parseQuery('from:ali').terms[0]).toEqual({ words: ['ali'], prefix: true, field: 'sender' })
    expect(parseQuery('"march inv"').terms[0]!.prefix).toBe(false)
    // Too short to be worth completing
    expect(parseQuery('march i').terms[1]!.prefix).toBe(false)
  })

  it('reads anything it does not recognise as text', () => {
    expect(parseQuery('meeting at 10:30 ').terms.map(t => t.words)).toEqual([['meeting'], ['at'], ['10', '30']])
    expect(parseQuery('re:hello ').terms.map(t => t.words)).toEqual([['re', 'hello']])
    expect(parseQuery('is:starred ').terms.map(t => t.words)).toEqual([['is', 'starred']])
    expect(parseQuery('before:tomorrow ').terms.map(t => t.words)).toEqual([['before', 'tomorrow']])
    expect(parseQuery('https://example.com/a?b=1 ').terms.map(t => t.words)).toEqual([['https', 'example', 'com', 'a', 'b', '1']])
  })

  it('ignores an operator that has no value yet', () => {
    expect(hasCriteria(parseQuery('in:inbox from:'))).toBe(false)
    expect(hasCriteria(parseQuery('in:inbox sort:oldest'))).toBe(false)
    expect(parseQuery('sort:newest x ').sort).toBe('newest')
    expect(parseQuery('sort:random ').terms.map(t => t.words)).toEqual([['sort', 'random']])
    expect(hasCriteria(parseQuery('in:inbox is:unread'))).toBe(true)
    expect(hasCriteria(parseQuery('... !!'))).toBe(false)
  })

  it('keeps an unclosed quote together', () => {
    expect(tokenizeQuery('"due at')).toEqual([{ raw: '"due at', key: null, value: 'due at', quoted: true }])
  })

  it('writes operators ahead of the free text', () => {
    expect(setOperator('invoice march', 'from', ['alice@example.com'])).toBe('from:alice@example.com invoice march')
    expect(setOperator('in:inbox from:bob invoice', 'from', [])).toBe('in:inbox invoice')
    expect(setOperator('in:inbox invoice', 'in', ['inbox', 'reply later'])).toBe('in:inbox in:"reply later" invoice')
    expect(setOperator('since:2026-01-01', 'after', ['2026-02-02'])).toBe('after:2026-02-02 ')
    expect(setOperator('', 'in', [])).toBe('')
    expect(parseQuery('in:"Reply Later"').folders).toEqual(['reply later'])
  })

  it('builds the equivalent FTS5 expression', () => {
    expect(toFtsMatch(parseQuery('from:alice@example.com "due at" inv'))).toBe('sender : "alice example com" AND "due at" AND "inv" *')
    expect(toFtsMatch(parseQuery('in:inbox is:unread'))).toBeNull()
    expect(toFtsMatch(parseQuery('"AND" (x) y* ^z '))).toBe('"and" AND "x" AND "y" AND "z"')
  })
})

describe('matching', () => {
  it('matches whole words, in any field', () => {
    expect(matches('invoice ')).toBe(true)
    expect(matches('voice ')).toBe(false)
    expect(matches('acme payment 2041 ')).toBe(true)
    expect(matches('acme refund ')).toBe(false)
    expect(matches('inv')).toBe(true)
    expect(matches('inv ')).toBe(false)
  })

  it('matches phrases across punctuation and line breaks, but not across fields', () => {
    expect(matches('"attached payment"')).toBe(true)
    expect(matches('bob.builder@widgets.example ')).toBe(true)
    expect(matches('widgets.example ')).toBe(true)
    expect(matches('widgets.builder ')).toBe(false)
    expect(matches('"march please"')).toBe(false)
  })

  it('keeps field terms to their field', () => {
    expect(matches('from:acme ')).toBe(true)
    expect(matches('from:bob ')).toBe(false)
    expect(matches('to:bob ')).toBe(true)
    expect(matches('subject:march ')).toBe(true)
    expect(matches('subject:payment ')).toBe(false)
    expect(matches('filename:pdf ')).toBe(true)
    expect(matches('filename:invoice-2041.pdf ')).toBe(true)
  })

  it('ignores case and accents', () => {
    expect(matches('CAFE ')).toBe(true)
    expect(matches('café ')).toBe(true)
    expect(matches('MÄRCH ')).toBe(true)
  })
})

describe('highlighting', () => {
  it('marks what matched, in the original text', () => {
    expect(highlight('Due at the Café today', parseQuery('cafe "due at" '), 'body')).toEqual([
      { text: 'Due at', hit: true },
      { text: ' the ', hit: false },
      { text: 'Café', hit: true },
      { text: ' today', hit: false },
    ])
  })

  it('marks the whole word for a prefix, and skips terms for other fields', () => {
    expect(highlight('Invoices and voices', parseQuery('from:and inv'), 'subject')).toEqual([
      { text: 'Invoices', hit: true },
      { text: ' and voices', hit: false },
    ])
    expect(highlight('Plain', parseQuery('other '), 'subject')).toEqual([{ text: 'Plain', hit: false }])
  })

  it('cuts a snippet around the first match', () => {
    const body = `${'Nothing of note was said. '.repeat(30)}Then the zeppelin arrived.\n\n${'More filler. '.repeat(30)}`
    const snippet = searchSnippet(body, parseQuery('zeppelin '))
    expect(snippet).toMatch(/^….*zeppelin arrived\. More filler.*…$/)
    expect(snippet.length).toBeLessThanOrEqual(202)
    // No match in the body: the start of it
    expect(searchSnippet(body, parseQuery('from:alice '))).toBe(body.slice(0, 200))
    expect(searchSnippet('Short  one\n', parseQuery('zeppelin '))).toBe('Short one')
  })
})

describe('local search', () => {
  const now = Date.now()

  async function search(query: string, unreadOnly = false): Promise<EmailSearchResult[]> {
    return searchLocal({ query, unreadOnly })
  }

  beforeEach(async () => {
    await resetDb()
    await db.folders.bulkPut(FOLDERS)
    await db.contacts.bulkPut([
      { id: ME.id, name: ME.name, email: ME.email, isMe: true, isDefaultIdentity: true },
      { id: ALICE.id, name: ALICE.name, email: ALICE.email, isMe: false, isDefaultIdentity: false },
    ])
    await storeThreads(
      [makeThread(1), makeThread(2), makeThread(3, { folderId: 2 })],
      [
        makeEmail(1, { id: 10, subject: 'Invoice 2041', contentText: 'First notice', date: now - 5 * DAY, readAt: now }),
        makeEmail(1, { id: 11, subject: 'Re: Invoice 2041', contentText: 'The invoice is paid', date: now - 2 * DAY }),
        makeEmail(2, {
          id: 20,
          subject: 'Holiday photos',
          contentText: 'See attached',
          date: now - DAY,
          readAt: now,
          sender: { ...ME, role: 'from' },
          recipients: [{ ...ALICE, role: 'to' }, { id: 3, name: 'Bob Builder', email: 'bob@widgets.example', isMe: false, role: 'cc' }],
          attachments: [
            { id: 1, filename: 'beach.jpg', mimeType: 'image/jpeg', size: 1, isInline: false, contentId: null },
            { id: 2, filename: 'logo.png', mimeType: 'image/png', size: 1, isInline: true, contentId: 'logo' },
          ],
        }),
        makeEmail(3, { id: 30, folderId: 2, subject: 'You won an invoice', contentText: 'Click here', date: now - 3 * DAY }),
      ],
      { touch: true }
    )
  })

  it('gives one result per thread, newest first', async () => {
    const results = await search('invoice ')
    expect(results.map(r => [r.threadId, r.emailId, r.matches])).toEqual([[1, 11, 2], [3, 30, 1]])
    expect(results[0]).toMatchObject({ subject: 'Re: Invoice 2041', snippet: 'The invoice is paid', isRead: false, draftId: null })
  })

  it('applies folders, read state, attachments and dates', async () => {
    expect((await search('in:inbox invoice ')).map(r => r.threadId)).toEqual([1])
    expect((await search('in:junk invoice ')).map(r => r.threadId)).toEqual([3])
    expect((await search('in:inbox in:junk invoice ')).map(r => r.threadId)).toEqual([1, 3])
    expect(await search('in:nowhere invoice ')).toEqual([])
    // Oldest first: threads by their oldest match
    expect((await search('invoice sort:oldest')).map(r => [r.threadId, r.emailId, r.matches])).toEqual([[1, 10, 2], [3, 30, 1]])
    expect((await search('in:inbox is:read')).map(r => r.emailId)).toEqual([20, 10])
    expect((await search('in:inbox', true)).map(r => r.emailId)).toEqual([11])
    expect((await search('has:attachment')).map(r => r.threadId)).toEqual([2])

    const day = (time: number) => {
      const date = new Date(time)
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }
    expect((await search(`after:${day(now - 2 * DAY)}`)).map(r => r.emailId)).toEqual([20, 11])
    expect((await search(`before:${day(now - 3 * DAY)}`)).map(r => r.emailId)).toEqual([30, 10])
  })

  it('finds mail by recipient and attachment name', async () => {
    expect((await search('to:bob ')).map(r => r.threadId)).toEqual([2])
    expect((await search('widgets.example ')).map(r => r.threadId)).toEqual([2])
    expect((await search('filename:beach ')).map(r => r.threadId)).toEqual([2])
    expect(await search('filename:logo ')).toEqual([])
    expect((await search('from:alice photos ')).map(r => r.threadId)).toEqual([])
  })

  it('finds drafts, in their thread or on their own', async () => {
    const draft = {
      senderId: ME.id,
      contentHtml: null,
      inReplyTo: null,
      forwardedMessageId: null,
      references: [],
      attachments: [],
      createdAt: now,
    }
    await db.drafts.bulkPut([
      { ...draft, id: 'reply', threadId: 1, subject: 'Re: Invoice 2041', contentText: 'Chasing the invoice remittance', recipients: [], updatedAt: now },
      { ...draft, id: 'new', threadId: null, subject: '', contentText: 'A remittance question', recipients: [{ email: 'carol@example.com', name: 'Carol', role: 'to' }], updatedAt: now - DAY },
    ])

    const results = await search('remittance ')
    expect(results.map(r => [r.threadId, r.draftId, r.emailId])).toEqual([[1, 'reply', null], [null, 'new', null]])
    expect(results[1]).toMatchObject({ subject: '(No subject)', senderName: 'Me', isRead: true })

    // A draft in a thread is one more match in that thread
    expect((await search('invoice '))[0]).toMatchObject({ threadId: 1, draftId: 'reply', matches: 3 })
    expect((await search('to:carol ')).map(r => r.draftId)).toEqual(['new'])
    // A new message sits in the Inbox; drafts are never unread
    expect((await search('in:inbox remittance ')).map(r => r.draftId)).toEqual(['reply', 'new'])
    expect((await search('in:junk remittance ')).map(r => r.draftId)).toEqual([])
    expect(await search('remittance ', true)).toEqual([])
  })

  it('merges device and server results by thread', async () => {
    const hit = (threadId: number, date: number, matches = 1): EmailSearchResult => ({
      emailId: threadId * 10, threadId, draftId: null, subject: '', snippet: '', senderName: null, senderEmail: '', date, isRead: true, matches,
    })
    const local = [hit(1, 50, 2), hit(2, 30)]
    const server = [hit(3, 10), hit(1, 40, 3)]

    expect(mergeResults(local, server, 'newest').map(r => [r.threadId, r.date, r.matches])).toEqual([[1, 50, 3], [2, 30, 1], [3, 10, 1]])
    expect(mergeResults(local, server, 'oldest').map(r => [r.threadId, r.date, r.matches])).toEqual([[3, 10, 1], [2, 30, 1], [1, 40, 3]])
  })
})
