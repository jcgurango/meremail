import { sqlite, config } from '@meremail/shared'
import type {
  SyncFolder,
  SyncContact,
  SyncThread,
  SyncEmail,
  SyncEmailMeta,
  SyncEmailRef,
  SyncParticipant,
  SyncAttachment,
  SyncDraft,
  SyncDraftAttachment,
  SyncDraftRecipient,
  SyncCounts,
  SyncConfig,
  SyncDeletion,
  SyncEntity,
  BootstrapResponse,
  ChangesResponse,
  ThreadsResponse,
  FolderPageResponse,
} from '@meremail/shared'

// Mail received within this many days is pushed to clients; anything older
// is only sent when a client asks for it
export const WINDOW_DAYS = 30

const CHANGES_PAGE_SIZE = 300
const SYNCED_ENTITIES: SyncEntity[] = ['folders', 'contacts', 'email_threads', 'emails', 'drafts']

// The date an email is ordered by: when it arrived, or for our own mail when
// it was sent / queued
const EMAIL_DATE = 'COALESCE(e.received_at, e.sent_at, e.queued_at, e.created_at)'

// ============== Helpers ==============

// Timestamp columns are stored in seconds
function ms(seconds: number | null): number | null {
  return seconds === null || seconds === undefined ? null : seconds * 1000
}

function windowCutoff(): number {
  return Math.floor(Date.now() / 1000) - WINDOW_DAYS * 24 * 60 * 60
}

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(',')
}

function chunk<T>(items: T[], size = 500): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return (JSON.parse(value) as T) ?? fallback
  } catch {
    return fallback
  }
}

export function currentSeq(): number {
  const row = sqlite.prepare('SELECT seq FROM sync_state WHERE id = 1').get() as { seq: number } | undefined
  return row?.seq ?? 0
}

export function getSyncConfig(): SyncConfig {
  return {
    imageProxyUrl: config.imageProxy.urlTemplate,
    maxAttachmentSize: config.uploads.maxSize,
    windowDays: WINDOW_DAYS,
  }
}

/**
 * Extract the Reply-To value from stored headers.
 * Headers are stored as raw lines: { key: 'reply-to', value: 'Reply-To: ...' }
 */
function extractReplyTo(headersJson: string | null): string | null {
  const headers = parseJson<{ key: string; value: string }[] | null>(headersJson, null)
  if (!Array.isArray(headers)) return null

  const header = headers.find(h => h?.key?.toLowerCase() === 'reply-to')
  if (!header?.value) return null

  const colon = header.value.indexOf(':')
  const value = (colon === -1 ? header.value : header.value.slice(colon + 1)).replace(/\s+/g, ' ').trim()
  return value || null
}

// ============== Loaders ==============

interface FolderRow {
  id: number
  name: string
  imapFolder: string | null
  position: number
  isSystem: number
  notificationsEnabled: number
  showUnreadCount: number
  syncOffline: number
}

function loadFolders(clause = '1=1', params: unknown[] = []): SyncFolder[] {
  const rows = sqlite.prepare(`
    SELECT id, name, imap_folder AS imapFolder, position, is_system AS isSystem,
      notifications_enabled AS notificationsEnabled, show_unread_count AS showUnreadCount,
      sync_offline AS syncOffline
    FROM folders WHERE ${clause} ORDER BY position
  `).all(...params) as FolderRow[]

  return rows.map(r => ({
    ...r,
    isSystem: !!r.isSystem,
    notificationsEnabled: !!r.notificationsEnabled,
    showUnreadCount: !!r.showUnreadCount,
    syncOffline: !!r.syncOffline,
  }))
}

function loadContacts(clause = '1=1', params: unknown[] = []): SyncContact[] {
  const rows = sqlite.prepare(`
    SELECT id, name, email, is_me AS isMe, is_default_identity AS isDefaultIdentity
    FROM contacts WHERE ${clause}
  `).all(...params) as { id: number; name: string | null; email: string; isMe: number; isDefaultIdentity: number }[]

  return rows.map(r => ({ ...r, isMe: !!r.isMe, isDefaultIdentity: !!r.isDefaultIdentity }))
}

interface ThreadRow {
  id: number
  subject: string
  folderId: number | null
  previousFolderId: number | null
  trashedAt: number | null
  replyLaterAt: number | null
  setAsideAt: number | null
  createdAt: number
  latestAt: number | null
}

function loadThreads(clause: string, params: unknown[] = []): SyncThread[] {
  const rows = sqlite.prepare(`
    SELECT t.id, t.subject, t.folder_id AS folderId, t.previous_folder_id AS previousFolderId,
      t.trashed_at AS trashedAt, t.reply_later_at AS replyLaterAt, t.set_aside_at AS setAsideAt,
      t.created_at AS createdAt,
      (SELECT MAX(${EMAIL_DATE}) FROM emails e WHERE e.thread_id = t.id) AS latestAt
    FROM email_threads t WHERE ${clause}
  `).all(...params) as ThreadRow[]

  return rows.map(r => ({
    ...r,
    trashedAt: ms(r.trashedAt),
    replyLaterAt: ms(r.replyLaterAt),
    setAsideAt: ms(r.setAsideAt),
    createdAt: ms(r.createdAt)!,
    latestAt: ms(r.latestAt),
  }))
}

interface EmailRow {
  id: number
  threadId: number
  folderId: number | null
  messageId: string | null
  inReplyTo: string | null
  references: string | null
  subject: string
  contentText: string
  contentHtml: string | null
  headers: string | null
  sentAt: number | null
  receivedAt: number | null
  date: number
  readAt: number | null
  status: 'queued' | 'sent'
  queuedAt: number | null
  sendAttempts: number | null
  lastSendError: string | null
  senderId: number
}

function loadEmails(clause: string, params: unknown[] = []): SyncEmail[] {
  const rows = sqlite.prepare(`
    SELECT e.id, e.thread_id AS threadId, t.folder_id AS folderId, e.message_id AS messageId,
      e.in_reply_to AS inReplyTo, e."references" AS "references", e.subject,
      e.content_text AS contentText, e.content_html AS contentHtml, e.headers,
      e.sent_at AS sentAt, e.received_at AS receivedAt, ${EMAIL_DATE} AS date,
      e.read_at AS readAt, e.status, e.queued_at AS queuedAt, e.send_attempts AS sendAttempts,
      e.last_send_error AS lastSendError, e.sender_id AS senderId
    FROM emails e
    JOIN email_threads t ON t.id = e.thread_id
    WHERE ${clause}
  `).all(...params) as EmailRow[]

  if (rows.length === 0) return []

  const emailIds = rows.map(r => r.id)
  const participants = new Map<number, SyncParticipant[]>()
  const attachments = new Map<number, SyncAttachment[]>()

  for (const ids of chunk(emailIds)) {
    const participantRows = sqlite.prepare(`
      SELECT ec.email_id AS emailId, ec.role, c.id, c.name, c.email, c.is_me AS isMe
      FROM email_contacts ec JOIN contacts c ON c.id = ec.contact_id
      WHERE ec.email_id IN (${placeholders(ids)})
    `).all(...ids) as { emailId: number; role: SyncParticipant['role']; id: number; name: string | null; email: string; isMe: number }[]

    for (const p of participantRows) {
      const list = participants.get(p.emailId) || []
      list.push({ id: p.id, name: p.name, email: p.email, isMe: !!p.isMe, role: p.role })
      participants.set(p.emailId, list)
    }

    const attachmentRows = sqlite.prepare(`
      SELECT email_id AS emailId, id, filename, mime_type AS mimeType, size, is_inline AS isInline, content_id AS contentId
      FROM attachments WHERE email_id IN (${placeholders(ids)})
    `).all(...ids) as { emailId: number; id: number; filename: string; mimeType: string | null; size: number | null; isInline: number; contentId: string | null }[]

    for (const a of attachmentRows) {
      const list = attachments.get(a.emailId) || []
      list.push({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size, isInline: !!a.isInline, contentId: a.contentId })
      attachments.set(a.emailId, list)
    }
  }

  // Senders normally have a 'from' link; fall back to sender_id for any that don't
  const senderIds = [...new Set(rows.map(r => r.senderId))]
  const senders = new Map<number, SyncContact>()
  for (const ids of chunk(senderIds)) {
    for (const c of loadContacts(`id IN (${placeholders(ids)})`, ids)) {
      senders.set(c.id, c)
    }
  }

  return rows.map((r) => {
    const all = participants.get(r.id) || []
    const fallback = senders.get(r.senderId)
    const sender: SyncParticipant | null = all.find(p => p.role === 'from')
      ?? (fallback ? { id: fallback.id, name: fallback.name, email: fallback.email, isMe: fallback.isMe, role: 'from' } : null)

    return {
      id: r.id,
      threadId: r.threadId,
      folderId: r.folderId,
      messageId: r.messageId,
      inReplyTo: r.inReplyTo,
      references: parseJson<string[]>(r.references, []),
      subject: r.subject,
      contentText: r.contentText,
      contentHtml: r.contentHtml,
      replyTo: extractReplyTo(r.headers),
      sentAt: ms(r.sentAt),
      receivedAt: ms(r.receivedAt),
      date: ms(r.date)!,
      readAt: ms(r.readAt),
      status: r.status,
      queuedAt: ms(r.queuedAt),
      sendAttempts: r.sendAttempts ?? 0,
      lastSendError: r.lastSendError,
      sender,
      recipients: all.filter(p => p.role !== 'from'),
      attachments: attachments.get(r.id) || [],
    }
  })
}

function loadEmailsForThreads(threadIds: number[]): SyncEmail[] {
  const emails: SyncEmail[] = []
  for (const ids of chunk(threadIds)) {
    emails.push(...loadEmails(`e.thread_id IN (${placeholders(ids)})`, ids))
  }
  return emails
}

function loadThreadsById(threadIds: number[]): SyncThread[] {
  const threads: SyncThread[] = []
  for (const ids of chunk(threadIds)) {
    threads.push(...loadThreads(`t.id IN (${placeholders(ids)})`, ids))
  }
  return threads
}

interface DraftRow {
  id: string
  threadId: number | null
  senderId: number
  subject: string
  contentText: string
  contentHtml: string | null
  inReplyTo: string | null
  forwardedMessageId: string | null
  references: string | null
  recipients: string
  createdAt: number
  updatedAt: number
}

export function loadDrafts(clause = '1=1', params: unknown[] = []): SyncDraft[] {
  const rows = sqlite.prepare(`
    SELECT id, thread_id AS threadId, sender_id AS senderId, subject, content_text AS contentText,
      content_html AS contentHtml, in_reply_to AS inReplyTo, forwarded_message_id AS forwardedMessageId,
      "references" AS "references", recipients, created_at AS createdAt, updated_at AS updatedAt
    FROM drafts WHERE ${clause}
  `).all(...params) as DraftRow[]

  if (rows.length === 0) return []

  const attachments = new Map<string, SyncDraftAttachment[]>()
  for (const ids of chunk(rows.map(r => r.id))) {
    const attachmentRows = sqlite.prepare(`
      SELECT id, draft_id AS draftId, filename, mime_type AS mimeType, size, is_inline AS isInline
      FROM draft_attachments WHERE draft_id IN (${placeholders(ids)}) ORDER BY created_at
    `).all(...ids) as { id: string; draftId: string; filename: string; mimeType: string | null; size: number | null; isInline: number }[]

    for (const a of attachmentRows) {
      const list = attachments.get(a.draftId) || []
      list.push({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size, isInline: !!a.isInline })
      attachments.set(a.draftId, list)
    }
  }

  return rows.map(r => ({
    ...r,
    references: parseJson<string[]>(r.references, []),
    recipients: parseJson<SyncDraftRecipient[]>(r.recipients, []),
    attachments: attachments.get(r.id) || [],
    createdAt: ms(r.createdAt)!,
    updatedAt: ms(r.updatedAt)!,
  }))
}

/**
 * Number of threads with unread mail in each folder
 */
export function getCounts(): SyncCounts {
  const rows = sqlite.prepare(`
    SELECT t.folder_id AS folderId, COUNT(DISTINCT t.id) AS count
    FROM emails e JOIN email_threads t ON t.id = e.thread_id
    WHERE e.read_at IS NULL AND t.folder_id IS NOT NULL
    GROUP BY t.folder_id
  `).all() as { folderId: number; count: number }[]

  const folders: Record<number, number> = {}
  for (const row of rows) {
    folders[row.folderId] = row.count
  }
  return { folders }
}

// ============== Endpoints ==============

/**
 * Starting point for a client with no data: reference data, plus the IDs of
 * the threads it should hold - anything with recent mail in a folder that
 * syncs offline, and everything in Reply Later / Set Aside or with a draft.
 */
export function bootstrap(): BootstrapResponse {
  return sqlite.transaction((): BootstrapResponse => {
    const threadRows = sqlite.prepare(`
      SELECT t.id, MAX(${EMAIL_DATE}) AS latest
      FROM email_threads t
      JOIN emails e ON e.thread_id = t.id
      LEFT JOIN folders f ON f.id = t.folder_id
      GROUP BY t.id
      HAVING (latest >= ? AND COALESCE(f.sync_offline, 1) = 1)
        OR t.reply_later_at IS NOT NULL
        OR t.set_aside_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM drafts d WHERE d.thread_id = t.id)
      ORDER BY latest DESC
    `).all(windowCutoff()) as { id: number }[]

    return {
      cursor: currentSeq(),
      serverTime: Date.now(),
      config: getSyncConfig(),
      folders: loadFolders(),
      contacts: loadContacts(),
      drafts: loadDrafts(),
      threadIds: threadRows.map(r => r.id),
      counts: getCounts(),
    }
  })()
}

/**
 * Everything that changed after `since`, oldest change first, one page at a time.
 */
export function changes(since: number, pageSize = CHANGES_PAGE_SIZE): ChangesResponse {
  return sqlite.transaction((): ChangesResponse => {
    const state = sqlite.prepare('SELECT seq, tombstone_floor AS tombstoneFloor FROM sync_state WHERE id = 1')
      .get() as { seq: number; tombstoneFloor: number }

    // A cursor from before pruned deletions (or from a different database) can't be resumed
    if (since < state.tombstoneFloor || since > state.seq) {
      return { reset: true }
    }

    // Find where this page ends: the rev of the pageSize-th change after `since`
    const boundary = sqlite.prepare(`
      SELECT rev FROM emails WHERE rev > @since
      UNION ALL SELECT meta_rev FROM emails WHERE meta_rev > @since AND meta_rev != rev
      UNION ALL SELECT rev FROM email_threads WHERE rev > @since
      UNION ALL SELECT rev FROM contacts WHERE rev > @since
      UNION ALL SELECT rev FROM folders WHERE rev > @since
      UNION ALL SELECT rev FROM drafts WHERE rev > @since
      UNION ALL SELECT rev FROM tombstones WHERE rev > @since
      ORDER BY 1 LIMIT 2 OFFSET @offset
    `).all({ since, offset: pageSize - 1 }) as { rev: number }[]

    const hasMore = boundary.length > 1
    const upTo = hasMore ? boundary[0]!.rev : state.seq
    const range = [since, upTo]
    const cutoff = windowCutoff()

    // Recent emails are sent in full; older ones (e.g. a bulk import of
    // historical mail) are only referenced, so clients aren't flooded
    const emails = loadEmails(`e.rev > ? AND e.rev <= ? AND ${EMAIL_DATE} >= ?`, [...range, cutoff])
    const emailRefs = sqlite.prepare(`
      SELECT e.id, e.thread_id AS threadId FROM emails e
      WHERE e.rev > ? AND e.rev <= ? AND e.thread_id IS NOT NULL AND ${EMAIL_DATE} < ?
    `).all(...range, cutoff) as SyncEmailRef[]

    const emailMetaRows = sqlite.prepare(`
      SELECT id, thread_id AS threadId, read_at AS readAt FROM emails
      WHERE meta_rev > ? AND meta_rev <= ? AND NOT (rev > ? AND rev <= ?) AND thread_id IS NOT NULL
    `).all(...range, ...range) as { id: number; threadId: number; readAt: number | null }[]
    const emailMeta: SyncEmailMeta[] = emailMetaRows.map(r => ({ ...r, readAt: ms(r.readAt) }))

    const deleted = sqlite.prepare(`
      SELECT entity, entity_id AS id FROM tombstones
      WHERE rev > ? AND rev <= ? AND entity IN (${placeholders(SYNCED_ENTITIES)})
      ORDER BY rev
    `).all(...range, ...SYNCED_ENTITIES) as SyncDeletion[]

    return {
      cursor: upTo,
      hasMore,
      serverTime: Date.now(),
      config: getSyncConfig(),
      folders: loadFolders('rev > ? AND rev <= ?', range),
      contacts: loadContacts('rev > ? AND rev <= ?', range),
      threads: loadThreads('t.rev > ? AND t.rev <= ?', range),
      emails,
      emailMeta,
      emailRefs,
      drafts: loadDrafts('rev > ? AND rev <= ?', range),
      deleted,
      counts: hasMore ? undefined : getCounts(),
    }
  })()
}

/**
 * Full threads (all emails) by ID
 */
export function fetchThreads(threadIds: number[]): ThreadsResponse {
  return sqlite.transaction((): ThreadsResponse => {
    const threads = loadThreadsById(threadIds)
    const found = new Set(threads.map(t => t.id))

    return {
      threads,
      emails: loadEmailsForThreads(threads.map(t => t.id)),
      missing: threadIds.filter(id => !found.has(id)),
    }
  })()
}

/**
 * A page of a folder's threads older than `before`, newest first.
 * This is how clients reach mail outside the window they hold.
 */
export function folderPage(folderId: number, before: number | null, limit = 25): FolderPageResponse {
  return sqlite.transaction((): FolderPageResponse => {
    const beforeSeconds = before === null ? Number.MAX_SAFE_INTEGER : Math.floor(before / 1000)

    // Over-fetch so the page can be extended to a clean date boundary
    const rows = sqlite.prepare(`
      SELECT t.id, MAX(${EMAIL_DATE}) AS latest
      FROM email_threads t JOIN emails e ON e.thread_id = t.id
      WHERE t.folder_id = ?
      GROUP BY t.id
      HAVING latest < ?
      ORDER BY latest DESC, t.id DESC
      LIMIT ?
    `).all(folderId, beforeSeconds, limit + 100) as { id: number; latest: number }[]

    // The cursor is a date, so never split threads sharing the same date across pages
    let end = Math.min(limit, rows.length)
    while (end > 0 && end < rows.length && rows[end]!.latest === rows[end - 1]!.latest) {
      end++
    }

    const page = rows.slice(0, end)
    const threadIds = page.map(r => r.id)
    const last = page[page.length - 1]

    return {
      threads: loadThreadsById(threadIds),
      emails: loadEmailsForThreads(threadIds),
      hasMore: rows.length > end,
      nextBefore: last ? last.latest * 1000 : null,
    }
  })()
}
