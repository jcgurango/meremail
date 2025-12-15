import {
  getOfflineDb,
  CACHE_LIMITS,
  type OfflineThread,
  type OfflineEmail,
  type CachedThread,
} from '@/utils/offline-db'
import { useOfflineDb } from './useOfflineDb'

// ============== Types ==============

interface ServerThread {
  id: number
  type: 'thread' | 'draft'
  subject: string
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

interface ServerEmail {
  id: number
  subject: string
  content: string
  contentText: string
  contentHtml: string | null
  sentAt: number | null
  receivedAt: number | null
  isRead: boolean
  status: string
  sender: {
    id: number
    name: string | null
    email: string
    isMe: boolean
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
  }>
}

interface ServerThreadDetail {
  id: number
  subject: string
  replyLaterAt: number | null
  setAsideAt: number | null
  emails: ServerEmail[]
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
    isMe: boolean
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
  }>
}

// ============== Set Aside Caching ==============

/**
 * Cache all Set Aside emails with attachments.
 */
export async function cacheSetAsideThreads(): Promise<void> {
  const db = getOfflineDb()
  const { cacheAttachmentBlob, updateCacheMeta, deleteAttachmentBlobsForCache } = useOfflineDb()

  try {
    // Fetch all Set Aside emails
    const response = await fetch('/api/set-aside?limit=100')
    if (!response.ok) throw new Error(`Failed to fetch set-aside: ${response.status}`)

    const data = await response.json() as { emails: SetAsideEmail[]; hasMore: boolean }

    const now = Date.now()
    let totalSize = 0

    // Clear existing Set Aside cache
    await db.cachedThreads.where('cacheType').equals('setAside').delete()
    await deleteAttachmentBlobsForCache('setAside')

    // Group emails by threadId to create cached threads
    const threadMap = new Map<number, SetAsideEmail[]>()
    for (const email of data.emails) {
      const existing = threadMap.get(email.threadId) || []
      existing.push(email)
      threadMap.set(email.threadId, existing)
    }

    // Cache each thread
    for (const [threadId, emails] of threadMap) {
      const offlineEmails: OfflineEmail[] = emails.map(email => ({
        id: email.id,
        threadId: email.threadId,
        subject: email.subject,
        contentText: '', // Set Aside returns rendered content
        contentHtml: email.content,
        sentAt: email.sentAt ? new Date(email.sentAt).getTime() : null,
        status: 'sent' as const,
        sender: email.sender ? {
          id: email.sender.id,
          name: email.sender.name,
          email: email.sender.email,
          isMe: email.sender.isMe,
          role: 'from',
        } : null,
        recipients: email.recipients.map(r => ({
          id: r.id,
          name: r.name,
          email: r.email,
          isMe: r.isMe,
          role: r.role,
        })),
        attachmentIds: email.attachments.map(a => a.id),
        cachedAt: now,
      }))

      // Cache attachments for this thread
      for (const email of emails) {
        for (const att of email.attachments) {
          if (att.size && totalSize + att.size <= CACHE_LIMITS.setAside) {
            const cached = await cacheAttachment(att.id, 'setAside')
            if (cached) {
              totalSize += att.size
            }
          }
        }
      }

      const cachedThread: CachedThread = {
        id: threadId,
        cacheType: 'setAside',
        subject: emails[0]?.subject || '',
        replyLaterAt: null,
        setAsideAt: now,
        emails: offlineEmails,
        cachedAt: now,
      }

      await db.cachedThreads.put(cachedThread)
    }

    // Update cache metadata
    await updateCacheMeta('setAside', totalSize, threadMap.size, 0)

    console.log(`[Offline] Cached ${threadMap.size} Set Aside threads with ${data.emails.length} emails`)
  } catch (e) {
    console.error('[Offline] Failed to cache Set Aside threads:', e)
    throw e
  }
}

// ============== Reply Later Caching ==============

/**
 * Cache all Reply Later threads with full content and attachments.
 */
export async function cacheReplyLaterThreads(): Promise<void> {
  const db = getOfflineDb()
  const { updateCacheMeta, deleteAttachmentBlobsForCache } = useOfflineDb()

  try {
    // Fetch Reply Later thread list
    const response = await fetch('/api/threads?replyLater=true&limit=50')
    if (!response.ok) throw new Error(`Failed to fetch threads: ${response.status}`)

    const data = await response.json() as { threads: ServerThread[]; hasMore: boolean }

    const now = Date.now()
    let totalSize = 0

    // Clear existing Reply Later cache
    await db.cachedThreads.where('cacheType').equals('replyLater').delete()
    await deleteAttachmentBlobsForCache('replyLater')

    // Fetch full content for each thread
    for (const thread of data.threads) {
      if (thread.type === 'draft') continue // Skip standalone drafts

      try {
        const threadResponse = await fetch(`/api/threads/${thread.id}`)
        if (!threadResponse.ok) continue

        const threadDetail = await threadResponse.json() as ServerThreadDetail

        const offlineEmails: OfflineEmail[] = threadDetail.emails.map(email => ({
          id: email.id,
          threadId: thread.id,
          subject: email.subject,
          contentText: email.contentText || '',
          contentHtml: email.contentHtml,
          sentAt: email.sentAt,
          status: email.status as 'draft' | 'sent',
          sender: email.sender ? {
            id: email.sender.id,
            name: email.sender.name,
            email: email.sender.email,
            isMe: email.sender.isMe,
            role: 'from',
          } : null,
          recipients: email.recipients.map(r => ({
            id: r.id,
            name: r.name,
            email: r.email,
            isMe: r.isMe,
            role: r.role,
          })),
          attachmentIds: email.attachments.map(a => a.id),
          cachedAt: now,
        }))

        // Cache attachments for this thread
        for (const email of threadDetail.emails) {
          for (const att of email.attachments) {
            if (att.size && totalSize + att.size <= CACHE_LIMITS.replyLater) {
              const cached = await cacheAttachment(att.id, 'replyLater')
              if (cached) {
                totalSize += att.size
              }
            }
          }
        }

        const cachedThread: CachedThread = {
          id: thread.id,
          cacheType: 'replyLater',
          subject: threadDetail.subject,
          replyLaterAt: threadDetail.replyLaterAt,
          setAsideAt: threadDetail.setAsideAt,
          emails: offlineEmails,
          cachedAt: now,
        }

        await db.cachedThreads.put(cachedThread)
      } catch (e) {
        console.error(`[Offline] Failed to cache Reply Later thread ${thread.id}:`, e)
      }
    }

    // Update cache metadata
    await updateCacheMeta('replyLater', totalSize, data.threads.length, 0)

    console.log(`[Offline] Cached ${data.threads.length} Reply Later threads`)
  } catch (e) {
    console.error('[Offline] Failed to cache Reply Later threads:', e)
    throw e
  }
}

// ============== Inbox Caching ==============

/**
 * Cache top 20 inbox threads (metadata only, no full content).
 */
export async function cacheInboxThreads(): Promise<void> {
  const db = getOfflineDb()
  const { updateCacheMeta } = useOfflineDb()

  try {
    // Fetch inbox threads
    const response = await fetch(`/api/threads?bucket=approved&limit=${CACHE_LIMITS.inboxThreads}`)
    if (!response.ok) throw new Error(`Failed to fetch threads: ${response.status}`)

    const data = await response.json() as { threads: ServerThread[]; hasMore: boolean }

    const now = Date.now()

    // Clear existing inbox cache
    await db.threads.clear()

    // Cache thread metadata
    const offlineThreads: OfflineThread[] = data.threads.map(thread => ({
      id: thread.id,
      type: thread.type,
      subject: thread.subject,
      latestEmailAt: thread.latestEmailAt ? new Date(thread.latestEmailAt).getTime() : null,
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
      cachedAt: now,
    }))

    await db.threads.bulkPut(offlineThreads)

    // Update cache metadata
    await updateCacheMeta('threads', 0, offlineThreads.length, 0)

    console.log(`[Offline] Cached ${offlineThreads.length} inbox threads`)
  } catch (e) {
    console.error('[Offline] Failed to cache inbox threads:', e)
    throw e
  }
}

// ============== Retrieval Functions ==============

/**
 * Get cached inbox threads.
 */
export async function getCachedInboxThreads(): Promise<OfflineThread[]> {
  const db = getOfflineDb()
  return db.threads.orderBy('latestEmailAt').reverse().toArray()
}

/**
 * Get cached Set Aside threads.
 */
export async function getCachedSetAsideThreads(): Promise<CachedThread[]> {
  const db = getOfflineDb()
  return db.cachedThreads
    .where('cacheType')
    .equals('setAside')
    .toArray()
}

/**
 * Get cached Reply Later threads.
 */
export async function getCachedReplyLaterThreads(): Promise<CachedThread[]> {
  const db = getOfflineDb()
  return db.cachedThreads
    .where('cacheType')
    .equals('replyLater')
    .toArray()
}

/**
 * Get a specific cached thread by ID.
 */
export async function getCachedThread(
  threadId: number,
  cacheType: 'setAside' | 'replyLater'
): Promise<CachedThread | undefined> {
  const db = getOfflineDb()
  return db.cachedThreads.get(threadId)
}

/**
 * Check if a thread is cached.
 */
export async function isThreadCached(
  threadId: number,
  cacheType: 'setAside' | 'replyLater'
): Promise<boolean> {
  const thread = await getCachedThread(threadId, cacheType)
  return thread?.cacheType === cacheType
}

// ============== Attachment Caching ==============

/**
 * Cache a single attachment blob.
 */
async function cacheAttachment(
  attachmentId: number,
  cacheType: 'setAside' | 'replyLater'
): Promise<boolean> {
  const { cacheAttachmentBlob, getAttachmentBlob } = useOfflineDb()

  // Check if already cached
  const existing = await getAttachmentBlob(attachmentId)
  if (existing) return true

  try {
    const response = await fetch(`/api/attachments/${attachmentId}`)
    if (!response.ok) return false

    const blob = await response.blob()
    return cacheAttachmentBlob(attachmentId, blob, cacheType)
  } catch (e) {
    console.error(`[Offline] Failed to cache attachment ${attachmentId}:`, e)
    return false
  }
}

/**
 * Get a cached attachment blob.
 */
export async function getCachedAttachment(attachmentId: number): Promise<Blob | null> {
  const { getAttachmentBlob } = useOfflineDb()
  return getAttachmentBlob(attachmentId)
}

// ============== Refresh All Caches ==============

/**
 * Refresh all thread caches (Set Aside, Reply Later, Inbox).
 */
export async function refreshThreadCaches(): Promise<void> {
  try {
    await Promise.allSettled([
      cacheSetAsideThreads(),
      cacheReplyLaterThreads(),
      cacheInboxThreads(),
    ])
  } catch (e) {
    console.error('[Offline] Failed to refresh thread caches:', e)
    throw e
  }
}

// ============== Composable ==============

/**
 * Composable for thread cache operations.
 */
export function useOfflineThreadCache() {
  return {
    // Caching
    cacheSetAside: cacheSetAsideThreads,
    cacheReplyLater: cacheReplyLaterThreads,
    cacheInbox: cacheInboxThreads,
    refreshAll: refreshThreadCaches,
    // Retrieval
    getInboxThreads: getCachedInboxThreads,
    getSetAsideThreads: getCachedSetAsideThreads,
    getReplyLaterThreads: getCachedReplyLaterThreads,
    getThread: getCachedThread,
    isThreadCached,
    getAttachment: getCachedAttachment,
  }
}
