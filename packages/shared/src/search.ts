/**
 * The search query language, shared by the server and the web client so a
 * query means the same thing on both.
 *
 * This file must stay free of runtime imports and Node types - the web
 * client imports it directly.
 *
 *   invoice march          every word must appear (the last one may be the start of a word)
 *   "exact phrase"         words next to each other, in order
 *   from:alice             sender name or address
 *   to:bob@example.com     any recipient (To, Cc or Bcc)
 *   subject:word           subject only
 *   filename:report.pdf    attachment name
 *   in:inbox               folder, by name; several are any-of
 *   has:attachment
 *   is:unread / is:read
 *   after:2026-01-31       on or after that day (also since:)
 *   before:2026-02-28      on or before that day (also until:)
 *   sort:oldest            oldest first; newest first (sort:newest) is the default
 *
 * Text is matched by whole words, ignoring case and accents. Punctuation
 * separates words, so `foo@bar.com` is the phrase "foo bar com" and matches
 * that address wherever it appears, as does `bar.com`.
 */

// ============== Words ==============

const WORD = /[\p{L}\p{N}]+/gu
const NOT_WORD = '[^\\p{L}\\p{N}]'

/** Lowercase, without accents - the form text is compared in */
export function foldText(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '')
}

export function words(text: string): string[] {
  return foldText(text).match(WORD) ?? []
}

// ============== Parsing ==============

export type SearchField = 'subject' | 'body' | 'sender' | 'recipients' | 'filenames'

export const SEARCH_FIELDS: SearchField[] = ['subject', 'body', 'sender', 'recipients', 'filenames']

/** Words that must appear next to each other, in order */
export interface SearchTerm {
  words: string[]
  /** The last word only has to be the start of a word */
  prefix: boolean
  /** Where to look; null for anywhere */
  field: SearchField | null
}

export interface SearchQuery {
  terms: SearchTerm[]
  /** Folder names, lowercase. Empty for all folders */
  folders: string[]
  hasAttachment: boolean
  /** null for either */
  unread: boolean | null
  /** yyyy-mm-dd, inclusive */
  after: string | null
  /** yyyy-mm-dd, inclusive */
  before: string | null
  sort: 'newest' | 'oldest'
}

export type OperatorKey = 'from' | 'to' | 'subject' | 'filename' | 'in' | 'has' | 'is' | 'after' | 'before' | 'sort'

const OPERATOR_ALIASES: Record<string, OperatorKey> = {
  from: 'from',
  to: 'to',
  cc: 'to',
  bcc: 'to',
  subject: 'subject',
  filename: 'filename',
  file: 'filename',
  in: 'in',
  has: 'has',
  is: 'is',
  after: 'after',
  since: 'after',
  before: 'before',
  until: 'before',
  sort: 'sort',
}

const TERM_FIELDS: Partial<Record<OperatorKey, SearchField>> = {
  from: 'sender',
  to: 'recipients',
  subject: 'subject',
  filename: 'filenames',
}

export interface QueryToken {
  /** The token exactly as typed */
  raw: string
  /** Set if the token is `key:value` with a known key */
  key: OperatorKey | null
  value: string
  quoted: boolean
}

/** Split a query into its space-separated parts, keeping quoted text together */
export function tokenizeQuery(text: string): QueryToken[] {
  const tokens: QueryToken[] = []
  const pattern = /(?:([A-Za-z]+):)?(?:"([^"]*)"?|(\S*))/gy
  let position = 0

  while (position < text.length) {
    if (/\s/.test(text[position]!)) {
      position++
      continue
    }
    pattern.lastIndex = position
    const match = pattern.exec(text)
    if (!match || match[0].length === 0) {
      position++
      continue
    }
    position += match[0].length

    const key = match[1] ? OPERATOR_ALIASES[match[1].toLowerCase()] ?? null : null
    if (key) {
      tokens.push({ raw: match[0], key, value: match[2] ?? match[3] ?? '', quoted: match[2] !== undefined })
    } else if (match[1]) {
      // Not an operator ("10:30", "re:"), so the whole thing is text
      const rest = /^\S*/.exec(text.slice(position))![0]
      position += rest.length
      const raw = match[0] + rest
      tokens.push({ raw, key: null, value: raw, quoted: false })
    } else {
      tokens.push({ raw: match[0], key: null, value: match[2] ?? match[3] ?? '', quoted: match[2] !== undefined })
    }
  }

  return tokens
}

function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(new Date(`${value}T00:00:00`).getTime())
}

export function parseQuery(text: string): SearchQuery {
  const query: SearchQuery = { terms: [], folders: [], hasAttachment: false, unread: null, after: null, before: null, sort: 'newest' }
  const tokens = tokenizeQuery(text)
  let lastUnquoted: SearchTerm | null = null

  const addTerm = (token: QueryToken, value: string, field: SearchField | null) => {
    const termWords = words(value)
    lastUnquoted = null
    if (termWords.length === 0) return
    const term: SearchTerm = { words: termWords, prefix: false, field }
    query.terms.push(term)
    if (!token.quoted) lastUnquoted = term
  }

  for (const token of tokens) {
    const value = token.value.trim()
    const flag = value.toLowerCase()

    if (!token.key) {
      addTerm(token, value, null)
      continue
    }

    lastUnquoted = null
    // Still being typed
    if (!value) continue

    if (TERM_FIELDS[token.key]) {
      addTerm(token, value, TERM_FIELDS[token.key]!)
    } else if (token.key === 'in') {
      if (!query.folders.includes(flag)) query.folders.push(flag)
    } else if (token.key === 'has' && (flag === 'attachment' || flag === 'attachments')) {
      query.hasAttachment = true
    } else if (token.key === 'is' && (flag === 'unread' || flag === 'read')) {
      query.unread = flag === 'unread'
    } else if (token.key === 'after' && isDay(value)) {
      query.after = value
    } else if (token.key === 'before' && isDay(value)) {
      query.before = value
    } else if (token.key === 'sort' && (flag === 'newest' || flag === 'oldest')) {
      query.sort = flag
    } else {
      // An operator with a value it doesn't understand is just text
      addTerm({ ...token, quoted: false }, token.raw, null)
    }
  }

  // Whatever is being typed right now is probably an unfinished word
  const typing = lastUnquoted as SearchTerm | null
  if (typing && !/\s$/.test(text) && typing.words[typing.words.length - 1]!.length >= 2) {
    typing.prefix = true
  }

  return query
}

/** True if the query asks for anything beyond a choice of folders and an order */
export function hasCriteria(query: SearchQuery): boolean {
  return query.terms.length > 0 || query.hasAttachment || query.unread !== null || query.after !== null || query.before !== null
}

/** The query's date range in epoch milliseconds, in the local timezone */
export function dateRange(query: SearchQuery): { from: number | null; to: number | null } {
  return {
    from: query.after ? new Date(`${query.after}T00:00:00`).getTime() : null,
    to: query.before ? new Date(`${query.before}T23:59:59.999`).getTime() : null,
  }
}

// ============== Editing ==============

function formatOperator(key: OperatorKey, value: string): string {
  return /\s/.test(value) ? `${key}:"${value.replace(/"/g, '')}"` : `${key}:${value}`
}

/**
 * Replace every use of an operator in a query with the given values.
 * Operators are kept ahead of the free text, so typing carries on at the end.
 */
export function setOperator(text: string, key: OperatorKey, values: string[]): string {
  const tokens = tokenizeQuery(text).filter(token => token.key !== key)
  const operators = tokens.filter(token => token.key).map(token => token.raw)
  const free = tokens.filter(token => !token.key).map(token => token.raw)
  const added = values.filter(Boolean).map(value => formatOperator(key, value))
  const result = [...operators, ...added, ...free].join(' ')
  return free.length === 0 && result ? `${result} ` : result
}

// ============== Matching ==============

export type SearchDocument = Record<SearchField, string>

function termPattern(term: SearchTerm, flags: string): RegExp {
  const phrase = term.words.join(`${NOT_WORD}+`)
  return new RegExp(`(?:^|${NOT_WORD})(${phrase})${term.prefix ? '' : `(?!${NOT_WORD.replace('^', '')})`}`, flags)
}

/** True if every term of the query is found in the document */
export function matchesText(document: SearchDocument, query: SearchQuery): boolean {
  if (query.terms.length === 0) return true
  const folded: Partial<SearchDocument> = {}

  return query.terms.every((term) => {
    const pattern = termPattern(term, 'u')
    return (term.field ? [term.field] : SEARCH_FIELDS).some((field) => {
      const text = folded[field] ??= foldText(document[field])
      // Cheap check before the precise one
      return term.words.every(word => text.includes(word)) && pattern.test(text)
    })
  })
}

/** The query as an FTS5 MATCH expression, or null if it has no text to match */
export function toFtsMatch(query: SearchQuery): string | null {
  if (query.terms.length === 0) return null
  return query.terms
    .map((term) => {
      const phrase = `"${term.words.join(' ')}"${term.prefix ? ' *' : ''}`
      return term.field ? `${term.field} : ${phrase}` : phrase
    })
    .join(' AND ')
}

// ============== Highlighting ==============

export interface TextSegment {
  text: string
  /** True if this part matched the search */
  hit: boolean
}

/** Folded text, with the position in the original of each of its characters */
function foldWithPositions(text: string): { folded: string; positions: number[] } {
  let folded = ''
  const positions: number[] = []
  let index = 0
  for (const char of text) {
    const code = char.charCodeAt(0)
    const lower = code < 128 ? (code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : char) : foldText(char)
    for (let i = 0; i < lower.length; i++) positions.push(index)
    folded += lower
    index += char.length
  }
  positions.push(text.length)
  return { folded, positions }
}

function termsFor(query: SearchQuery, field: SearchField): SearchTerm[] {
  return query.terms.filter(term => term.field === null || term.field === field)
}

/** Split text into the parts that matched the query's terms for a field, and the rest */
export function highlight(text: string, query: SearchQuery, field: SearchField): TextSegment[] {
  const terms = termsFor(query, field)
  if (!text || terms.length === 0) return text ? [{ text, hit: false }] : []

  const { folded, positions } = foldWithPositions(text)
  const ranges: [number, number][] = []
  for (const term of terms) {
    const pattern = termPattern(term, 'gu')
    let match: RegExpExecArray | null
    while ((match = pattern.exec(folded))) {
      const start = match.index + match[0].length - match[1]!.length
      // A prefix match lights up the whole word
      let end = start + match[1]!.length
      if (term.prefix) {
        const rest = /^[\p{L}\p{N}]*/u.exec(folded.slice(end))
        end += rest ? rest[0].length : 0
      }
      ranges.push([positions[start]!, positions[end]!])
      pattern.lastIndex = Math.max(end, match.index + 1)
    }
  }
  if (ranges.length === 0) return [{ text, hit: false }]

  ranges.sort((a, b) => a[0] - b[0])
  const segments: TextSegment[] = []
  let cursor = 0
  for (const [start, end] of ranges) {
    if (end <= cursor) continue
    const from = Math.max(start, cursor)
    if (from > cursor) segments.push({ text: text.slice(cursor, from), hit: false })
    segments.push({ text: text.slice(from, end), hit: true })
    cursor = end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false })
  return segments
}

const SNIPPET_LENGTH = 200
const SNIPPET_LEAD = 60

/**
 * A short extract of an email body: around the first place the query
 * matches, or the start of the text if it doesn't match the body.
 */
export function searchSnippet(body: string, query: SearchQuery): string {
  const text = body.replace(/\s+/g, ' ').trim()
  const terms = termsFor(query, 'body')
  if (terms.length === 0 || text.length <= SNIPPET_LENGTH) return text.slice(0, SNIPPET_LENGTH)

  // Folding almost never changes the length of text, so positions in the
  // folded text are close enough to cut the original by
  const folded = foldText(text)
  let first = -1
  for (const term of terms) {
    const match = termPattern(term, 'u').exec(folded)
    if (match && (first === -1 || match.index < first)) first = match.index
  }
  if (first <= SNIPPET_LEAD) return text.slice(0, SNIPPET_LENGTH) + '…'

  let start = first - SNIPPET_LEAD
  const space = text.indexOf(' ', start)
  if (space !== -1 && space < first) start = space + 1
  const end = start + SNIPPET_LENGTH
  return '…' + text.slice(start, end) + (end < text.length ? '…' : '')
}

// ============== Results ==============

/** A thread (or unsent draft) found by a search, shown as its best-matching message */
export interface EmailSearchHit {
  /** The matching email; null for a draft */
  emailId: number | null
  /** null for a draft that isn't part of a thread */
  threadId: number | null
  /** Set if the match is an unsent draft (only ever found on the device it is held on) */
  draftId: string | null
  subject: string
  snippet: string
  senderName: string | null
  senderEmail: string
  /** Epoch milliseconds */
  date: number
  isRead: boolean
  /** How many messages in the thread matched */
  matches: number
}
