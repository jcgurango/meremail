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
  generateLocalDraftId,
  isLocalId,
  type SyncThread,
  type SyncEmail,
  type SyncContact,
  type SyncParticipant,
} from './sync-db'
import { registerBackgroundSync } from '@/composables/useOffline'

// ============== Types ==============

interface UnreadCounts {
  folders: { [folderId: number]: number }
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
  queuedCount: number
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
    status: 'draft' | 'queued' | 'sent'
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
    queuedAt?: string | null
    sendAttempts?: number
    lastSendError?: string | null
  }>
  defaultFromId: number | null
}

interface Contact {
  id: number
  name: string | null
  email: string
  isMe?: boolean
  isDefaultIdentity?: boolean
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

  const counts: UnreadCounts = {
    folders: {},
    reply_later: 0,
    set_aside: 0,
  }

  for (const thread of threads) {
    // Count by folder
    if (thread.folderId) {
      counts.folders[thread.folderId] = (counts.folders[thread.folderId] || 0) + thread.unreadCount
    }
    // Count reply later (threads with replyLaterAt set)
    if (thread.replyLaterAt) {
      counts.reply_later += thread.unreadCount
    }
    // Count set aside (threads with setAsideAt set)
    if (thread.setAsideAt) {
      counts.set_aside += thread.unreadCount
    }
  }

  return { data: counts, fromCache: true }
}

export interface Folder {
  id: number
  name: string
  imapFolder: string | null
  position: number
  isSystem?: boolean
  notificationsEnabled: boolean
  showUnreadCount: boolean
  syncOffline: boolean
  unreadCount: number
}

/**
 * GET /api/folders
 */
export async function getFolders(): Promise<{ data: { folders: Folder[] }; fromCache: boolean }> {
  // Try network first
  const networkResult = await tryFetch<{ folders: Folder[] }>('/api/folders')
  if (networkResult) return networkResult

  // Fallback to sync cache - use synced folder metadata
  const db = getSyncDb()
  const syncedFolders = await db.folders.orderBy('position').toArray()
  const threads = await db.threads.toArray()

  // Count unreads per folder
  const folderCounts: Record<number, number> = {}
  for (const thread of threads) {
    if (thread.folderId) {
      folderCounts[thread.folderId] = (folderCounts[thread.folderId] || 0) + thread.unreadCount
    }
  }

  // Use synced folders if available, otherwise fallback to defaults
  let folders: Folder[]
  if (syncedFolders.length > 0) {
    folders = syncedFolders.map(f => ({
      id: f.id,
      name: f.name,
      imapFolder: f.imapFolder,
      position: f.position,
      notificationsEnabled: f.notificationsEnabled,
      showUnreadCount: f.showUnreadCount,
      syncOffline: f.syncOffline,
      unreadCount: folderCounts[f.id] || 0,
    }))
  } else {
    // Default folders if nothing synced yet
    folders = [
      { id: 1, name: 'Inbox', imapFolder: 'INBOX', position: 0, notificationsEnabled: true, showUnreadCount: true, syncOffline: true, unreadCount: folderCounts[1] || 0 },
      { id: 2, name: 'Junk', imapFolder: 'Junk', position: 1, notificationsEnabled: false, showUnreadCount: false, syncOffline: false, unreadCount: folderCounts[2] || 0 },
    ]
  }

  return { data: { folders }, fromCache: true }
}

/**
 * GET /api/threads?folderId=X&offset=0
 * GET /api/threads?queue=reply_later&offset=0
 *
 * Only supports offset=0 (first page) from cache.
 */
export async function getThreads(params: {
  folderId?: number
  queue?: 'reply_later' | 'set_aside'
  offset?: number
  limit?: number
}): Promise<{ data: { threads: ThreadListItem[]; hasMore: boolean }; fromCache: boolean }> {
  // Build URL
  const searchParams = new URLSearchParams()
  if (params.folderId !== undefined) searchParams.set('folderId', String(params.folderId))
  if (params.queue) searchParams.set('queue', params.queue)
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

  // Get from sync cache
  const db = getSyncDb()
  let allThreads = await db.threads.toArray()

  // Filter threads based on params
  let filteredThreads: typeof allThreads
  if (params.queue === 'reply_later') {
    filteredThreads = allThreads.filter(t => t.replyLaterAt !== null)
  } else if (params.queue === 'set_aside') {
    filteredThreads = allThreads.filter(t => t.setAsideAt !== null)
  } else if (params.folderId !== undefined) {
    filteredThreads = allThreads.filter(t => t.folderId === params.folderId)
  } else {
    // Default to Inbox (folderId=1)
    filteredThreads = allThreads.filter(t => t.folderId === 1)
  }

  const threads = filteredThreads.map(syncThreadToListItem)

  // Sort based on query type (matching server sorting logic)
  if (params.queue === 'reply_later') {
    // Reply later: sort by replyLaterAt, then by date
    threads.sort((a, b) => {
      const aReplyLater = a.replyLaterAt ? new Date(a.replyLaterAt).getTime() : Infinity
      const bReplyLater = b.replyLaterAt ? new Date(b.replyLaterAt).getTime() : Infinity
      if (aReplyLater !== bReplyLater) return aReplyLater - bReplyLater

      const aDate = a.latestEmailAt ? new Date(a.latestEmailAt).getTime() : 0
      const bDate = b.latestEmailAt ? new Date(b.latestEmailAt).getTime() : 0
      return bDate - aDate
    })
  } else {
    // Default: drafts-only first, then unread, then by date
    threads.sort((a, b) => {
      // Drafts-only threads first (draftCount > 0 && draftCount === totalCount)
      const aIsDraftOnly = a.draftCount > 0 && a.draftCount === a.totalCount ? 1 : 0
      const bIsDraftOnly = b.draftCount > 0 && b.draftCount === b.totalCount ? 1 : 0
      if (aIsDraftOnly !== bIsDraftOnly) return bIsDraftOnly - aIsDraftOnly

      // Then unread threads
      const aHasUnread = a.unreadCount > 0 ? 1 : 0
      const bHasUnread = b.unreadCount > 0 ? 1 : 0
      if (aHasUnread !== bHasUnread) return bHasUnread - aHasUnread

      // Then by date (newest first)
      const aDate = a.latestEmailAt ? new Date(a.latestEmailAt).getTime() : 0
      const bDate = b.latestEmailAt ? new Date(b.latestEmailAt).getTime() : 0
      return bDate - aDate
    })
  }

  return {
    data: { threads, hasMore: false },
    fromCache: true,
  }
}

/**
 * GET /api/threads/:id
 */
export async function getThread(threadId: number, markRead = true): Promise<{ data: ThreadDetail; fromCache: boolean } | null> {
  const db = getSyncDb()

  // Try network first
  const url = markRead ? `/api/threads/${threadId}` : `/api/threads/${threadId}?markRead=false`
  const networkResult = await tryFetch<ThreadDetail>(url)
  if (networkResult) {
    // Merge any pending local drafts and filter out pending deletes
    const pendingItems = await db.pendingSync.filter(p => p.entityType === 'draft').toArray()
    const pendingDeleteIds = new Set(
      pendingItems.filter(p => p.action === 'delete').map(p => p.entityId)
    )
    const pendingCreateIds = new Set(
      pendingItems.filter(p => p.action === 'create').map(p => p.entityId)
    )
    const pendingSendIds = new Set(
      pendingItems.filter(p => p.action === 'send').map(p => p.entityId)
    )

    // Filter out emails that are pending deletion
    let emails = networkResult.data.emails.filter(e => !pendingDeleteIds.has(e.id))

    // Update status for emails with pending send (server still shows draft, but locally queued)
    // Also get queuedAt from local cache
    const pendingSendEmailsCache = new Map<number, { queuedAt: number | null }>()
    if (pendingSendIds.size > 0) {
      for (const id of pendingSendIds) {
        const cached = await db.emails.get(id)
        if (cached) {
          pendingSendEmailsCache.set(id, { queuedAt: cached.queuedAt })
        }
      }
    }
    emails = emails.map(e => {
      if (pendingSendIds.has(e.id) && e.status === 'draft') {
        const cached = pendingSendEmailsCache.get(e.id)
        const queuedAt = cached?.queuedAt ? new Date(cached.queuedAt).toISOString() : new Date().toISOString()
        return { ...e, status: 'queued' as const, queuedAt }
      }
      return e
    })

    // Add any local drafts (negative IDs) that haven't been synced yet
    if (pendingCreateIds.size > 0) {
      const localDrafts = await db.emails
        .filter(e => e.threadId === threadId && isLocalId(e.id))
        .toArray()

      for (const draft of localDrafts) {
        emails.push({
          id: draft.id,
          subject: draft.subject,
          content: draft.contentHtml || draft.contentText,
          contentText: draft.contentText,
          contentHtml: draft.contentHtml,
          sentAt: draft.sentAt ? new Date(draft.sentAt).toISOString() : null,
          receivedAt: draft.receivedAt ? new Date(draft.receivedAt).toISOString() : null,
          isRead: draft.isRead,
          status: draft.status as 'draft' | 'queued' | 'sent',
          sender: draft.sender ? {
            id: draft.sender.id,
            name: draft.sender.name,
            email: draft.sender.email,
            isMe: draft.sender.isMe,
            role: 'from',
          } : null,
          recipients: draft.recipients.map(r => ({
            id: r.id,
            name: r.name,
            email: r.email,
            isMe: r.isMe,
            role: r.role,
          })),
          attachments: draft.attachments.map(a => ({
            id: a.id,
            filename: a.filename,
            mimeType: a.mimeType,
            size: a.size,
            isInline: a.isInline ?? null,
          })),
          replyTo: draft.replyTo ?? undefined,
          messageId: draft.messageId ?? undefined,
          references: draft.references
            ? (Array.isArray(draft.references) ? draft.references : draft.references.split(/\s+/))
            : undefined,
          inReplyTo: draft.inReplyTo ?? undefined,
          queuedAt: draft.queuedAt ? new Date(draft.queuedAt).toISOString() : null,
          sendAttempts: draft.sendAttempts ?? 0,
          lastSendError: draft.lastSendError ?? null,
        })
      }
    }

    return {
      data: { ...networkResult.data, emails },
      fromCache: false,
    }
  }

  // Fallback to sync cache
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

  // Filter out pending deletes from cache too
  const pendingDeletes = await db.pendingSync
    .filter(p => p.entityType === 'draft' && p.action === 'delete')
    .toArray()
  const pendingDeleteIds = new Set(pendingDeletes.map(p => p.entityId))
  emails = emails.filter(e => !pendingDeleteIds.has(e.id))

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
      status: e.status as 'draft' | 'queued' | 'sent',
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
      queuedAt: e.queuedAt ? new Date(e.queuedAt).toISOString() : null,
      sendAttempts: e.sendAttempts ?? 0,
      lastSendError: e.lastSendError ?? null,
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
  // Use filter instead of where().equals() to avoid boolean indexing quirks
  const meContacts = await db.contacts.filter(c => c.isMe === true).toArray()

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
 * POST /api/contacts/:id/set-default-identity
 */
export async function setDefaultIdentity(contactId: number): Promise<void> {
  const res = await fetch(`/api/contacts/${contactId}/set-default-identity`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to set default identity')
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
    recipients: Array<{ id?: number; name: string | null; email: string; role: string }>
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
    recipients: Array<{ id?: number; name: string | null; email: string; role: string }>
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
  const setAsideThreads = await db.threads.filter(t => t.setAsideAt !== null).toArray()

  const emails: SetAsideEmail[] = []

  for (const thread of setAsideThreads) {
    // Get all emails for this thread
    const threadEmails = await db.emails.where('threadId').equals(thread.id).toArray()

    for (const e of threadEmails) {
      emails.push({
        id: e.id,
        threadId: thread.id,
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

// ============== Draft Mutations ==============
// All draft content is stored in the sync cache (threads + emails tables).
// The pendingSync table only tracks which drafts need to be synced to the server.

export interface DraftData {
  threadId?: number | null
  senderId: number
  subject?: string
  contentText?: string
  contentHtml?: string | null
  recipients?: Array<{
    id?: number
    email: string
    name?: string | null
    role: 'to' | 'cc' | 'bcc'
  }>
  attachmentIds?: number[]
  inReplyTo?: string | null
  references?: string[] | null
}

export interface DraftResult {
  draftId: number  // The ID in the sync cache (negative for local-only, positive for server)
  pending: boolean
}

/**
 * Create a new draft.
 * Always stores in sync cache immediately (for UI).
 * If online, also creates on server.
 * If offline, queues for sync.
 */
export async function createDraft(data: DraftData): Promise<DraftResult> {
  const db = getSyncDb()
  const now = Date.now()

  // Get sender info for the cache entry
  const sender = await db.contacts.get(data.senderId)
  const senderParticipant: SyncParticipant | null = sender ? {
    id: sender.id,
    name: sender.name,
    email: sender.email,
    isMe: true,
    role: 'from',
  } : null

  // Note: id is 0 for unresolved recipients (email-only, no contact yet)
  // Server will handle these via pendingRecipients
  const recipients: SyncParticipant[] = (data.recipients || []).map(r => ({
    id: r.id ?? 0,
    name: r.name || null,
    email: r.email,
    isMe: false,
    role: r.role,
  }))

  // Try to create on server first
  if (!isOffline()) {
    try {
      const response = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: data.threadId,
          senderId: data.senderId,
          subject: data.subject || '',
          contentText: data.contentText || '',
          contentHtml: data.contentHtml,
          recipients: data.recipients || [],
          inReplyTo: data.inReplyTo,
          references: data.references,
        }),
      })

      if (response.ok) {
        const result = await response.json() as { id: number }

        // Store in sync cache with server ID
        await storeDraftInCache(db, {
          id: result.id,
          threadId: data.threadId,
          subject: data.subject || '',
          contentText: data.contentText || '',
          contentHtml: data.contentHtml ?? null,
          sender: senderParticipant,
          recipients,
          attachments: [],
          inReplyTo: data.inReplyTo ?? null,
          references: data.references?.join(' ') ?? null,
          cachedAt: now,
        })

        return { draftId: result.id, pending: false }
      }
    } catch {
      // Fall through to offline handling
    }
  }

  // Offline: generate local ID and store in cache
  const localId = await generateLocalDraftId()

  await storeDraftInCache(db, {
    id: localId,
    threadId: data.threadId,
    subject: data.subject || '',
    contentText: data.contentText || '',
    contentHtml: data.contentHtml ?? null,
    sender: senderParticipant,
    recipients,
    attachments: [],
    inReplyTo: data.inReplyTo ?? null,
    references: data.references?.join(' ') ?? null,
    cachedAt: now,
  })

  // Queue for sync
  await db.pendingSync.add({
    entityType: 'draft',
    entityId: localId,
    action: 'create',
    createdAt: now,
  })
  registerBackgroundSync()

  return { draftId: localId, pending: true }
}

/**
 * Update an existing draft.
 * Always updates sync cache immediately (for UI).
 * If online, also updates on server.
 * If offline, queues for sync.
 */
export async function updateDraft(
  draftId: number,
  data: Partial<DraftData>
): Promise<{ pending: boolean }> {
  const db = getSyncDb()
  const now = Date.now()

  // Get existing draft from cache
  const existingEmail = await db.emails.get(draftId)
  if (!existingEmail) {
    throw new Error('Draft not found in cache')
  }

  // Build updated sender if provided
  let sender = existingEmail.sender
  if (data.senderId !== undefined) {
    const senderContact = await db.contacts.get(data.senderId)
    sender = senderContact ? {
      id: senderContact.id,
      name: senderContact.name,
      email: senderContact.email,
      isMe: true,
      role: 'from' as const,
    } : null
  }

  // Build updated recipients if provided
  // Note: id is 0 for unresolved recipients (email-only, no contact yet)
  const recipients = data.recipients
    ? data.recipients.map(r => ({
        id: r.id ?? 0,
        name: r.name || null,
        email: r.email,
        isMe: false,
        role: r.role as 'to' | 'cc' | 'bcc',
      }))
    : existingEmail.recipients

  // Update sync cache
  await db.emails.update(draftId, {
    subject: data.subject ?? existingEmail.subject,
    contentText: data.contentText ?? existingEmail.contentText,
    contentHtml: data.contentHtml !== undefined ? data.contentHtml : existingEmail.contentHtml,
    sender,
    recipients,
    inReplyTo: data.inReplyTo !== undefined ? data.inReplyTo : existingEmail.inReplyTo,
    references: data.references ? data.references.join(' ') : existingEmail.references,
    cachedAt: now,
  })

  // Also update thread entry
  await db.threads.update(draftId, {
    subject: data.subject ?? existingEmail.subject,
    snippet: (data.contentText ?? existingEmail.contentText).slice(0, 150),
    participants: recipients,
    cachedAt: now,
  })

  // Try to update on server if it has a server ID
  if (!isOffline() && !isLocalId(draftId)) {
    try {
      const response = await fetch(`/api/drafts/${draftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: data.senderId,
          subject: data.subject,
          contentText: data.contentText,
          contentHtml: data.contentHtml,
          recipients: data.recipients,
          inReplyTo: data.inReplyTo,
          references: data.references,
        }),
      })

      if (response.ok) {
        return { pending: false }
      }
    } catch {
      // Fall through to offline handling
    }
  }

  // Queue for sync (avoid duplicates)
  const existingSync = await db.pendingSync
    .filter(p => p.entityType === 'draft' && p.entityId === draftId)
    .first()

  if (!existingSync) {
    await db.pendingSync.add({
      entityType: 'draft',
      entityId: draftId,
      action: isLocalId(draftId) ? 'create' : 'update',
      createdAt: now,
    })
    registerBackgroundSync()
  }

  return { pending: true }
}

/**
 * Delete a draft.
 * Always removes from sync cache immediately (for UI).
 * If online and has server ID, deletes on server.
 * If offline with server ID, queues deletion for sync.
 */
export async function deleteDraft(draftId: number): Promise<{ pending: boolean }> {
  const db = getSyncDb()
  const now = Date.now()
  const hasServerId = !isLocalId(draftId)

  // Remove from sync cache immediately
  await db.emails.delete(draftId)
  await db.threads.delete(draftId)

  // Remove any pending create/update syncs for this draft
  const pendingToDelete = await db.pendingSync
    .filter(p => p.entityType === 'draft' && p.entityId === draftId)
    .toArray()
  for (const p of pendingToDelete) {
    if (p.id) await db.pendingSync.delete(p.id)
  }

  // If it has a server ID, we need to delete on server
  if (hasServerId) {
    if (!isOffline()) {
      try {
        const response = await fetch(`/api/drafts/${draftId}`, { method: 'DELETE' })
        if (response.ok) {
          return { pending: false }
        }
      } catch {
        // Fall through to offline handling
      }
    }

    // Queue deletion for sync
    await db.pendingSync.add({
      entityType: 'draft',
      entityId: draftId,
      action: 'delete',
      createdAt: now,
    })
    registerBackgroundSync()

    return { pending: true }
  }

  // Local-only draft, just removing from cache is enough
  return { pending: false }
}

/**
 * Queue a draft for sending.
 * If online, immediately queues on server.
 * If offline, stores in pendingSync and transitions locally to 'queued'.
 */
export async function sendDraft(draftId: number): Promise<{ pending: boolean }> {
  const db = getSyncDb()
  const now = Date.now()

  // Get email before updating to check threadId
  const email = await db.emails.get(draftId)

  // Update local cache to queued immediately
  await db.emails.update(draftId, {
    status: 'queued',
    queuedAt: now,
    sendAttempts: 0,
    lastSendError: null,
  })

  // Also update thread entry if standalone draft
  if (email && !email.threadId) {
    // Standalone draft - update thread type
    await db.threads.update(draftId, {
      type: 'draft', // Keep as draft type but the email status shows queued
    })
  }

  // If this is in a thread, check if we should clear replyLaterAt locally
  // (clear when no more drafts remain - queued emails are considered "handled")
  if (email?.threadId) {
    const remainingDrafts = await db.emails
      .filter(e => e.threadId === email.threadId && e.status === 'draft' && e.id !== draftId)
      .count()

    if (remainingDrafts === 0) {
      await db.threads.update(email.threadId, { replyLaterAt: null })
    }
  }

  // Check if already has a pending create (local draft not yet synced)
  const pendingCreate = await db.pendingSync
    .filter(p => p.entityType === 'draft' && p.entityId === draftId && p.action === 'create')
    .first()

  // If it's a local draft that hasn't been synced yet, we need to create then send
  // The sync handler will handle this sequence
  if (isLocalId(draftId) || pendingCreate) {
    // Add send to pending sync - sync handler will create first, then send
    await db.pendingSync.add({
      entityType: 'draft',
      entityId: draftId,
      action: 'send',
      createdAt: now,
    })
    registerBackgroundSync()
    return { pending: true }
  }

  // Try to send to server if online
  if (!isOffline()) {
    try {
      const response = await fetch(`/api/drafts/${draftId}/send`, {
        method: 'POST',
      })

      if (response.ok) {
        const result = await response.json() as { success: boolean; status: string; threadId?: number }

        // If server created a thread for a standalone draft, update local cache
        if (result.threadId && email && !email.threadId) {
          // Update the email to point to the new thread
          await db.emails.update(draftId, { threadId: result.threadId })

          // Remove the standalone draft entry from threads table (was using draftId as thread ID)
          await db.threads.delete(draftId)

          // Create a proper thread entry for the new thread
          await db.threads.put({
            id: result.threadId,
            type: 'thread',
            subject: email.subject || '(No subject)',
            createdAt: now,
            replyLaterAt: null,
            setAsideAt: null,
            latestEmailAt: now,
            unreadCount: 0,
            totalCount: 1,
            draftCount: 0,
            queuedCount: 1,
            participants: email.recipients || [],
            snippet: email.contentText?.substring(0, 150) || '',
            cachedAt: now,
            defaultFromId: email.sender?.id || null,
            hasFullContent: false,
            folderId: 1, // New threads go to Inbox
          })
        }

        // Clean up any pending update/create entries for this draft
        const pendingEntries = await db.pendingSync
          .filter(p => p.entityType === 'draft' && p.entityId === draftId)
          .toArray()
        for (const entry of pendingEntries) {
          await db.pendingSync.delete(entry.id!)
        }
        return { pending: false }
      }
    } catch {
      // Fall through to offline handling
    }
  }

  // Queue for sync
  await db.pendingSync.add({
    entityType: 'draft',
    entityId: draftId,
    action: 'send',
    createdAt: now,
  })
  registerBackgroundSync()

  return { pending: true }
}

/**
 * Helper to store a draft in the sync cache (threads + emails tables).
 */
async function storeDraftInCache(
  db: ReturnType<typeof getSyncDb>,
  draft: {
    id: number
    threadId?: number | null  // If set, this is a reply to an existing thread
    subject: string
    contentText: string
    contentHtml: string | null
    sender: SyncParticipant | null
    recipients: SyncParticipant[]
    attachments: Array<{ id: number; filename: string; mimeType: string | null; size: number | null; isInline: boolean }>
    inReplyTo: string | null
    references: string | null
    cachedAt: number
  }
): Promise<void> {
  if (draft.threadId) {
    // Reply draft - add to existing thread
    const existingThread = await db.threads.get(draft.threadId)
    if (existingThread) {
      // Update existing thread's draft count
      await db.threads.update(draft.threadId, {
        draftCount: existingThread.draftCount + 1,
        cachedAt: draft.cachedAt,
      })
    }

    // Store email linked to the thread
    const email: SyncEmail = {
      id: draft.id,
      threadId: draft.threadId,
      subject: draft.subject,
      contentText: draft.contentText,
      contentHtml: draft.contentHtml,
      sentAt: null,
      receivedAt: null,
      isRead: true,
      status: 'draft',
      sender: draft.sender,
      recipients: draft.recipients,
      attachments: draft.attachments,
      replyTo: null,
      messageId: null,
      references: draft.references,
      inReplyTo: draft.inReplyTo,
      cachedAt: draft.cachedAt,
      queuedAt: null,
      sendAttempts: 0,
      lastSendError: null,
    }
    await db.emails.put(email)
  } else {
    // Standalone draft - create a new "thread" entry
    const thread: SyncThread = {
      id: draft.id,
      type: 'draft',
      subject: draft.subject || '(No subject)',
      createdAt: draft.cachedAt,
      replyLaterAt: null,
      setAsideAt: null,
      latestEmailAt: draft.cachedAt,
      unreadCount: 0,
      totalCount: 1,
      draftCount: 1,
      queuedCount: 0,
      participants: draft.recipients,
      snippet: draft.contentText.slice(0, 150),
      defaultFromId: draft.sender?.id ?? null,
      cachedAt: draft.cachedAt,
      hasFullContent: true,
      folderId: 1, // Standalone drafts go to Inbox
    }
    await db.threads.put(thread)

    // Store as email with status='draft'
    const email: SyncEmail = {
      id: draft.id,
      threadId: null, // Standalone draft
      subject: draft.subject,
      contentText: draft.contentText,
      contentHtml: draft.contentHtml,
      sentAt: null,
      receivedAt: null,
      isRead: true,
      status: 'draft',
      sender: draft.sender,
      recipients: draft.recipients,
      attachments: draft.attachments,
      replyTo: null,
      messageId: null,
      references: draft.references,
      inReplyTo: draft.inReplyTo,
      cachedAt: draft.cachedAt,
      queuedAt: null,
      sendAttempts: 0,
      lastSendError: null,
    }
    await db.emails.put(email)
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
    queuedCount: thread.queuedCount,
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

// ============== Rules API ==============

export interface RuleCondition {
  field: string
  matchType: 'exact' | 'contains' | 'regex'
  value: string
  negate?: boolean
}

export interface RuleConditionGroup {
  operator: 'AND' | 'OR'
  conditions: (RuleCondition | RuleConditionGroup)[]
}

export interface Rule {
  id: number
  name: string
  conditions: RuleConditionGroup
  actionType: string
  actionConfig: { folderId?: number } | null
  folderIds: number[]
  position: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface RuleApplication {
  id: number
  ruleId: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  totalCount: number
  processedCount: number
  matchedCount: number
  error: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

export async function getRules(): Promise<{ rules: Rule[] }> {
  const response = await fetch('/api/rules')
  if (!response.ok) throw new Error('Failed to fetch rules')
  return response.json()
}

export async function getRule(id: number): Promise<{ rule: Rule }> {
  const response = await fetch(`/api/rules/${id}`)
  if (!response.ok) throw new Error('Failed to fetch rule')
  return response.json()
}

export async function createRule(data: {
  name: string
  conditions: RuleConditionGroup
  actionType: string
  actionConfig?: { folderId?: number }
  folderIds?: number[]
  enabled?: boolean
}): Promise<{ rule: Rule }> {
  const response = await fetch('/api/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error('Failed to create rule')
  return response.json()
}

export async function updateRule(id: number, data: Partial<{
  name: string
  conditions: RuleConditionGroup
  actionType: string
  actionConfig: { folderId?: number }
  folderIds: number[]
  enabled: boolean
}>): Promise<{ rule: Rule }> {
  const response = await fetch(`/api/rules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error('Failed to update rule')
  return response.json()
}

export async function deleteRule(id: number): Promise<{ success: boolean }> {
  const response = await fetch(`/api/rules/${id}`, { method: 'DELETE' })
  if (!response.ok) throw new Error('Failed to delete rule')
  return response.json()
}

export async function reorderRules(positions: { id: number; position: number }[]): Promise<{ success: boolean }> {
  const response = await fetch('/api/rules/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positions }),
  })
  if (!response.ok) throw new Error('Failed to reorder rules')
  return response.json()
}

export async function applyRule(id: number): Promise<{ application: { id: number; status: string; totalCount: number } }> {
  const response = await fetch(`/api/rules/${id}/apply`, { method: 'POST' })
  if (!response.ok) throw new Error('Failed to apply rule')
  return response.json()
}

export async function getRuleApplication(id: number): Promise<{ application: RuleApplication }> {
  const response = await fetch(`/api/rules/applications/${id}`)
  if (!response.ok) throw new Error('Failed to fetch application status')
  return response.json()
}

export interface RuleApplicationWithName extends RuleApplication {
  ruleName: string | null
}

export async function getRuleApplications(): Promise<{ applications: RuleApplicationWithName[] }> {
  const response = await fetch('/api/rules/applications')
  if (!response.ok) throw new Error('Failed to fetch applications')
  return response.json()
}

export interface RulePreviewMatch {
  id: number
  threadId: number | null
  subject: string
  senderName: string | null
  senderEmail: string
  sentAt: string | null
}

export async function previewRule(conditions: RuleConditionGroup, folderIds: number[]): Promise<{
  matches: RulePreviewMatch[]
  scannedCount: number
  matchCount: number
}> {
  const response = await fetch('/api/rules/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conditions, folderIds }),
  })
  if (!response.ok) throw new Error('Failed to preview rule')
  return response.json()
}

export async function addSenderToRule(ruleId: number, email: string): Promise<{ success: boolean; emailCount: number; error?: string }> {
  const response = await fetch(`/api/rules/${ruleId}/add-sender`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  const data = await response.json()
  if (!response.ok) {
    return { success: false, emailCount: 0, error: data.error || 'Failed to add sender' }
  }
  return data
}

// ============== Folders API (extended) ==============

export async function createFolder(name: string): Promise<{ folder: Folder }> {
  const response = await fetch('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!response.ok) throw new Error('Failed to create folder')
  return response.json()
}

export async function updateFolder(id: number, updates: {
  name?: string
  notificationsEnabled?: boolean
  showUnreadCount?: boolean
  syncOffline?: boolean
}): Promise<{ folder: Folder }> {
  const response = await fetch(`/api/folders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!response.ok) throw new Error('Failed to update folder')
  return response.json()
}

export async function deleteFolder(id: number): Promise<{ success: boolean; deletedThreads: number }> {
  const response = await fetch(`/api/folders/${id}`, { method: 'DELETE' })
  if (!response.ok) throw new Error('Failed to delete folder')
  return response.json()
}

export async function reorderFolders(positions: { id: number; position: number }[]): Promise<{ success: boolean }> {
  const response = await fetch('/api/folders/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positions }),
  })
  if (!response.ok) throw new Error('Failed to reorder folders')
  return response.json()
}

// ============== Trash API ==============

export async function trashThread(id: number): Promise<{ success: boolean; trashedAt: string }> {
  const response = await fetch(`/api/threads/${id}/trash`, { method: 'POST' })
  if (!response.ok) throw new Error('Failed to trash thread')
  return response.json()
}

export async function restoreThread(id: number): Promise<{ success: boolean; folderId: number }> {
  const response = await fetch(`/api/threads/${id}/restore`, { method: 'POST' })
  if (!response.ok) throw new Error('Failed to restore thread')
  return response.json()
}

export async function permanentlyDeleteThread(id: number): Promise<{ success: boolean }> {
  const response = await fetch(`/api/threads/${id}`, { method: 'DELETE' })
  if (!response.ok) throw new Error('Failed to delete thread')
  return response.json()
}
