/**
 * Offline-aware API layer.
 *
 * Intercepts API calls and serves from IndexedDB sync cache when:
 * - The network request fails
 * - The browser is offline
 *
 * Components should use these functions instead of raw fetch().
 */

import {
  getSyncDb,
  type SyncThread,
  type SyncEmail,
  type SyncContact,
  type SyncBucketType,
} from './sync-db'

// ============== Types ==============

interface UnreadCounts {
  inbox: number
  feed: number
  paper_trail: number
  quarantine: number
  reply_later: number
  set_aside: number
}

interface ThreadListItem {
  id: number
  type: 'thread' | 'draft'
  subject: string
  createdAt: string
  replyLaterAt: string | null
  setAsideAt: string | null
  latestEmailAt: string | null
  unreadCount: number
  totalCount: number
  draftCount: number
  participants: Array<{
    id: number
    name: string | null
    email: string
    isMe?: boolean
    role: string
  }>
  snippet: string
}

interface ThreadDetail {
  id: number
  subject: string
  createdAt: string
  replyLaterAt: string | null
  setAsideAt: string | null
  emails: Array<{
    id: number
    subject: string
    content: string
    contentText: string
    contentHtml: string | null
    sentAt: string | null
    receivedAt: string | null
    isRead: boolean
    status: 'draft' | 'sent'
    sender: {
      id: number
      name: string | null
      email: string
      isMe?: boolean
      role: string
    } | null
    recipients: Array<{
      id: number
      name: string | null
      email: string
      isMe: boolean
      role: string
    }>
    attachments: Array<{
      id: number
      filename: string
      mimeType: string | null
      size: number | null
      isInline: boolean | null
    }>
    replyTo?: string | null
    messageId?: string | null
    references?: string[] | null
    inReplyTo?: string | null
  }>
  defaultFromId: number | null
}

interface Contact {
  id: number
  name: string | null
  email: string
  bucket?: string | null
  isMe?: boolean
}

// ============== Helpers ==============

function isOffline(): boolean {
  return !navigator.onLine
}

async function tryFetch<T>(url: string, options?: RequestInit): Promise<{ data: T; fromCache: false } | null> {
  if (isOffline()) return null

  try {
    const response = await fetch(url, options)
    if (!response.ok) return null
    const data = await response.json() as T
    return { data, fromCache: false }
  } catch {
    return null
  }
}

// ============== API Functions ==============

/**
 * GET /api/unread-counts
 */
export async function getUnreadCounts(): Promise<{ data: UnreadCounts; fromCache: boolean }> {
  // Try network first
  const networkResult = await tryFetch<UnreadCounts>('/api/unread-counts')
  if (networkResult) return networkResult

  // Fallback to sync cache - compute from synced threads
  const db = getSyncDb()
  const threads = await db.threads.toArray()
  const memberships = await db.bucketMembership.toArray()

  // Build a map of threadId -> buckets
  const threadBuckets = new Map<number, Set<string>>()
  for (const m of memberships) {
    if (!threadBuckets.has(m.threadId)) {
      threadBuckets.set(m.threadId, new Set())
    }
    threadBuckets.get(m.threadId)!.add(m.bucket)
  }

  const counts: UnreadCounts = {
    inbox: 0,
    feed: 0,
    paper_trail: 0,
    quarantine: 0,
    reply_later: 0,
    set_aside: 0,
  }

  for (const thread of threads) {
    const buckets = threadBuckets.get(thread.id)
    if (!buckets) continue

    if (buckets.has('approved')) counts.inbox += thread.unreadCount
    if (buckets.has('feed')) counts.feed += thread.unreadCount
    if (buckets.has('paper_trail')) counts.paper_trail += thread.unreadCount
    if (buckets.has('quarantine')) counts.quarantine += thread.unreadCount
    if (buckets.has('reply_later')) counts.reply_later += thread.unreadCount
    if (buckets.has('set_aside')) counts.set_aside += thread.unreadCount
  }

  return { data: counts, fromCache: true }
}

/**
 * GET /api/threads?bucket=X&offset=0
 * GET /api/threads?replyLater=true&offset=0
 *
 * Only supports offset=0 (first page) from cache.
 */
export async function getThreads(params: {
  bucket?: string
  replyLater?: boolean
  offset?: number
  limit?: number
}): Promise<{ data: { threads: ThreadListItem[]; hasMore: boolean }; fromCache: boolean }> {
  // Build URL
  const searchParams = new URLSearchParams()
  if (params.bucket) searchParams.set('bucket', params.bucket)
  if (params.replyLater) searchParams.set('replyLater', 'true')
  if (params.offset !== undefined) searchParams.set('offset', String(params.offset))
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit))

  const url = `/api/threads?${searchParams}`

  // Try network first
  const networkResult = await tryFetch<{ threads: ThreadListItem[]; hasMore: boolean }>(url)
  if (networkResult) return networkResult

  // Only serve from cache if offset=0 (first page)
  if (params.offset && params.offset > 0) {
    return { data: { threads: [], hasMore: false }, fromCache: true }
  }

  // Determine which bucket to query
  let syncBucket: SyncBucketType
  if (params.replyLater) {
    syncBucket = 'reply_later'
  } else if (params.bucket) {
    syncBucket = params.bucket as SyncBucketType
  } else {
    syncBucket = 'approved'
  }

  // Get from sync cache
  const db = getSyncDb()
  const memberships = await db.bucketMembership
    .where('bucket')
    .equals(syncBucket)
    .toArray()

  memberships.sort((a, b) => b.sortKey - a.sortKey)

  const threads: ThreadListItem[] = []
  for (const m of memberships) {
    const thread = await db.threads.get(m.threadId)
    if (thread) {
      threads.push(syncThreadToListItem(thread))
    }
  }

  return {
    data: { threads, hasMore: false },
    fromCache: true,
  }
}

/**
 * GET /api/threads/:id
 */
export async function getThread(threadId: number): Promise<{ data: ThreadDetail; fromCache: boolean } | null> {
  // Try network first
  const networkResult = await tryFetch<ThreadDetail>(`/api/threads/${threadId}`)
  if (networkResult) return networkResult

  // Fallback to sync cache
  const db = getSyncDb()
  const thread = await db.threads.get(threadId)
  if (!thread) return null

  // Get emails for this thread
  let emails: SyncEmail[]
  if (thread.type === 'draft') {
    // Standalone draft - email id matches thread id
    const draftEmail = await db.emails.get(threadId)
    emails = draftEmail ? [draftEmail] : []
  } else {
    emails = await db.emails.where('threadId').equals(threadId).sortBy('sentAt')
  }

  const detail: ThreadDetail = {
    id: thread.id,
    subject: thread.subject,
    createdAt: new Date(thread.createdAt).toISOString(),
    replyLaterAt: thread.replyLaterAt ? new Date(thread.replyLaterAt).toISOString() : null,
    setAsideAt: thread.setAsideAt ? new Date(thread.setAsideAt).toISOString() : null,
    emails: emails.map(e => ({
      id: e.id,
      subject: e.subject,
      content: e.contentHtml || e.contentText,
      contentText: e.contentText,
      contentHtml: e.contentHtml,
      sentAt: e.sentAt ? new Date(e.sentAt).toISOString() : null,
      receivedAt: e.receivedAt ? new Date(e.receivedAt).toISOString() : null,
      isRead: e.isRead,
      status: e.status as 'draft' | 'sent',
      sender: e.sender ? {
        id: e.sender.id,
        name: e.sender.name,
        email: e.sender.email,
        isMe: e.sender.isMe,
        role: 'from',
      } : null,
      recipients: e.recipients.map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        isMe: r.isMe,
        role: r.role,
      })),
      attachments: e.attachments.map(a => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        isInline: a.isInline ?? null,
      })),
      replyTo: e.replyTo ?? undefined,
      messageId: e.messageId ?? undefined,
      references: e.references
        ? (Array.isArray(e.references) ? e.references : e.references.split(/\s+/))
        : undefined,
      inReplyTo: e.inReplyTo ?? undefined,
    })),
    defaultFromId: thread.defaultFromId,
  }

  return { data: detail, fromCache: true }
}

/**
 * GET /api/contacts/me
 */
export async function getMeContacts(): Promise<{ data: { contacts: Contact[] }; fromCache: boolean }> {
  // Try network first
  const networkResult = await tryFetch<{ contacts: Contact[] }>('/api/contacts/me')
  if (networkResult) return networkResult

  // Fallback to sync cache
  const db = getSyncDb()
  const meContacts = await db.contacts.where('isMe').equals(1).toArray()

  return {
    data: {
      contacts: meContacts.map(c => ({
        id: c.id,
        name: c.name,
        email: c.email,
      })),
    },
    fromCache: true,
  }
}

/**
 * GET /api/contacts?q=X&limit=Y
 */
export async function searchContacts(query: string, limit = 20): Promise<{ data: { contacts: Contact[]; hasMore: boolean }; fromCache: boolean }> {
  // Try network first
  const url = `/api/contacts?q=${encodeURIComponent(query)}&limit=${limit}`
  const networkResult = await tryFetch<{ contacts: Contact[]; hasMore: boolean }>(url)
  if (networkResult) return networkResult

  // Fallback to sync cache
  const db = getSyncDb()
  const searchTerm = query.toLowerCase().trim()

  if (searchTerm.length < 2) {
    return { data: { contacts: [], hasMore: false }, fromCache: true }
  }

  const matches = await db.contacts
    .filter(c => {
      const nameMatch = c.name?.toLowerCase().includes(searchTerm) ?? false
      const emailMatch = c.email.toLowerCase().includes(searchTerm)
      return nameMatch || emailMatch
    })
    .limit(limit)
    .toArray()

  return {
    data: {
      contacts: matches.map(c => ({
        id: c.id,
        name: c.name,
        email: c.email,
        bucket: c.bucket,
        isMe: c.isMe,
      })),
      hasMore: false,
    },
    fromCache: true,
  }
}

/**
 * GET /api/drafts/:id
 */
export async function getDraft(draftId: number): Promise<{
  data: {
    id: number
    subject: string
    contentText: string
    contentHtml: string | null
    sender: { id: number; name: string | null; email: string } | null
    recipients: Array<{ id: number; name: string | null; email: string; role: string }>
    attachments: Array<{ id: number; filename: string; mimeType: string | null; size: number | null; isInline: boolean | null }>
  }
  fromCache: boolean
} | null> {
  // Try network first
  const networkResult = await tryFetch<{
    id: number
    subject: string
    contentText: string
    contentHtml: string | null
    sender: { id: number; name: string | null; email: string }
    recipients: Array<{ id: number; name: string | null; email: string; role: string }>
    attachments: Array<{ id: number; filename: string; mimeType: string | null; size: number | null; isInline: boolean | null }>
  }>(`/api/drafts/${draftId}`)

  if (networkResult) return networkResult

  // Fallback to sync cache - standalone drafts are stored with email.id = draft.id
  const db = getSyncDb()
  const email = await db.emails.get(draftId)

  if (email && email.status === 'draft') {
    return {
      data: {
        id: email.id,
        subject: email.subject,
        contentText: email.contentText,
        contentHtml: email.contentHtml,
        sender: email.sender ? {
          id: email.sender.id,
          name: email.sender.name,
          email: email.sender.email,
        } : null,
        recipients: email.recipients.map(r => ({
          id: r.id,
          name: r.name,
          email: r.email,
          role: r.role,
        })),
        attachments: email.attachments.map(a => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
          isInline: a.isInline,
        })),
      },
      fromCache: true,
    }
  }

  return null
}

interface SetAsideEmail {
  id: number
  threadId: number
  subject: string
  content: string
  sentAt: string | null
  receivedAt: string | null
  isRead: boolean
  sender: {
    id: number
    name: string | null
    email: string
    isMe?: boolean
    role?: string
  } | null
  recipients: Array<{
    id: number
    name: string | null
    email: string
    isMe?: boolean
    role?: string
  }>
  attachments: Array<{
    id: number
    filename: string
    mimeType: string | null
    size: number | null
  }>
  replyTo?: string | null
}

/**
 * GET /api/set-aside
 */
export async function getSetAsideEmails(exclude: number[] = []): Promise<{
  data: { emails: SetAsideEmail[]; hasMore: boolean }
  fromCache: boolean
}> {
  // Build URL
  const url = exclude.length > 0
    ? `/api/set-aside?exclude=${exclude.join(',')}`
    : '/api/set-aside'

  // Try network first
  const networkResult = await tryFetch<{ emails: SetAsideEmail[]; hasMore: boolean }>(url)
  if (networkResult) return networkResult

  // Fallback to sync cache - only for initial load (no exclude)
  if (exclude.length > 0) {
    return { data: { emails: [], hasMore: false }, fromCache: true }
  }

  const db = getSyncDb()

  // Get threads that have setAsideAt set
  const memberships = await db.bucketMembership
    .where('bucket')
    .equals('set_aside')
    .toArray()

  const emails: SetAsideEmail[] = []

  for (const m of memberships) {
    const thread = await db.threads.get(m.threadId)
    if (!thread) continue

    // Get all emails for this thread
    const threadEmails = await db.emails.where('threadId').equals(m.threadId).toArray()

    for (const e of threadEmails) {
      emails.push({
        id: e.id,
        threadId: m.threadId,
        subject: e.subject,
        content: e.contentHtml || e.contentText,
        sentAt: e.sentAt ? new Date(e.sentAt).toISOString() : null,
        receivedAt: e.receivedAt ? new Date(e.receivedAt).toISOString() : null,
        isRead: e.isRead,
        sender: e.sender ? {
          id: e.sender.id,
          name: e.sender.name,
          email: e.sender.email,
          isMe: e.sender.isMe,
          role: e.sender.role,
        } : null,
        recipients: e.recipients.map(r => ({
          id: r.id,
          name: r.name,
          email: r.email,
          isMe: r.isMe,
          role: r.role,
        })),
        attachments: e.attachments.map(a => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
        })),
        replyTo: e.replyTo ?? undefined,
      })
    }
  }

  // Sort by sentAt descending
  emails.sort((a, b) => {
    const aTime = a.sentAt ? new Date(a.sentAt).getTime() : 0
    const bTime = b.sentAt ? new Date(b.sentAt).getTime() : 0
    return bTime - aTime
  })

  return {
    data: { emails, hasMore: false },
    fromCache: true,
  }
}

// ============== Converters ==============

function syncThreadToListItem(thread: SyncThread): ThreadListItem {
  return {
    id: thread.id,
    type: thread.type,
    subject: thread.subject,
    createdAt: new Date(thread.createdAt).toISOString(),
    replyLaterAt: thread.replyLaterAt ? new Date(thread.replyLaterAt).toISOString() : null,
    setAsideAt: thread.setAsideAt ? new Date(thread.setAsideAt).toISOString() : null,
    latestEmailAt: thread.latestEmailAt ? new Date(thread.latestEmailAt).toISOString() : null,
    unreadCount: thread.unreadCount,
    totalCount: thread.totalCount,
    draftCount: thread.draftCount,
    participants: thread.participants.map(p => ({
      id: p.id,
      name: p.name,
      email: p.email,
      isMe: p.isMe,
      role: p.role,
    })),
    snippet: thread.snippet,
  }
}
