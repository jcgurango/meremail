import { ref, readonly } from 'vue'
import {
  getSyncDb,
  SYNC_LIMITS,
  isLocalId,
  type SyncFolder,
  type SyncThread,
  type SyncEmail,
  type SyncContact,
  type SyncParticipant,
} from '@/utils/sync-db'

// ============== API Response Types ==============

interface ApiThreadListItem {
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
  folderId?: number
}

interface ApiEmail {
  id: number
  subject: string
  content: string
  contentText: string
  contentHtml: string | null
  sentAt: number | null
  receivedAt: number | null
  isRead: boolean
  status: 'draft' | 'queued' | 'sent' | 'received'
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
    isInline?: boolean
  }>
  replyTo: string | null
  messageId: string | null
  references: string | null
  inReplyTo: string | null
  queuedAt?: string | null
  sendAttempts?: number
  lastSendError?: string | null
}

interface ApiThreadDetail {
  id: number
  subject: string
  createdAt: string
  replyLaterAt: number | null
  setAsideAt: number | null
  folderId: number | null
  emails: ApiEmail[]
  defaultFromId: number | null
}

interface ApiDraftDetail {
  id: number
  subject: string
  contentText: string
  contentHtml: string | null
  threadId: number | null
  sender: { id: number; name: string | null; email: string }
  recipients: Array<{ id: number; name: string | null; email: string; role: string }>
  attachments: Array<{ id: number; filename: string; mimeType: string | null; size: number | null; isInline?: boolean }>
}

interface ApiContact {
  id: number
  name: string | null
  email: string
  isMe: boolean
  lastEmailAt: string | null
  emailCount: number
}

interface ApiSetAsideEmail {
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

// ============== Sync State ==============

interface ApiFolder {
  id: number
  name: string
  imapFolder: string | null
  position: number
  unreadCount: number
}

type SyncStatus = 'idle' | 'syncing' | 'error'

const syncStatus = ref<Record<string, SyncStatus>>({
  folders: 'idle',
  inbox: 'idle',
  junk: 'idle',
  reply_later: 'idle',
  set_aside: 'idle',
  contacts: 'idle',
  attachments: 'idle',
})

const lastSyncError = ref<string | null>(null)
const isSyncing = ref(false)

// ============== Helper Functions ==============

function parseDate(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const ts = new Date(dateStr).getTime()
  return isNaN(ts) ? null : ts
}

function toSyncParticipant(p: { id: number; name: string | null; email: string; isMe?: boolean; role: string }): SyncParticipant {
  return {
    id: p.id,
    name: p.name,
    email: p.email,
    isMe: p.isMe ?? false,
    role: p.role as 'from' | 'to' | 'cc' | 'bcc',
  }
}

// ============== Folder Syncing ==============

async function syncFolders(): Promise<SyncFolder[]> {
  const db = getSyncDb()
  const now = Date.now()

  syncStatus.value['folders'] = 'syncing'

  try {
    const response = await fetch('/api/folders')
    if (!response.ok) throw new Error(`Failed to fetch folders: ${response.status}`)

    const data = await response.json() as { folders: ApiFolder[] }

    // Clear and re-populate
    await db.folders.clear()

    const folders: SyncFolder[] = data.folders.map(f => ({
      id: f.id,
      name: f.name,
      imapFolder: f.imapFolder,
      position: f.position,
      cachedAt: now,
    }))

    if (folders.length > 0) {
      await db.folders.bulkPut(folders)
    }

    await db.syncMeta.put({
      key: 'folders',
      lastSyncedAt: now,
      itemCount: folders.length,
    })

    syncStatus.value['folders'] = 'idle'
    console.log(`[Sync] Synced ${folders.length} folders`)
    return folders
  } catch (e) {
    console.error('[Sync] Failed to sync folders:', e)
    syncStatus.value['folders'] = 'error'
    throw e
  }
}

// ============== Thread Syncing ==============

async function syncThreadOrDraft(
  item: ApiThreadListItem,
  folderId: number,
  now: number
): Promise<void> {
  const db = getSyncDb()

  if (item.type === 'draft') {
    // Standalone draft - fetch draft details
    try {
      const draftResponse = await fetch(`/api/drafts/${item.id}`)
      if (!draftResponse.ok) return

      const draft = await draftResponse.json() as ApiDraftDetail

      // Store as a "thread" with type='draft'
      const syncThread: SyncThread = {
        id: item.id,
        type: 'draft',
        subject: draft.subject || '(No subject)',
        createdAt: parseDate(item.createdAt) ?? now,
        replyLaterAt: parseDate(item.replyLaterAt),
        setAsideAt: parseDate(item.setAsideAt),
        latestEmailAt: parseDate(item.latestEmailAt),
        unreadCount: 0,
        totalCount: 1,
        draftCount: 1,
        queuedCount: 0,
        participants: draft.recipients.map(r => ({
          id: r.id,
          name: r.name,
          email: r.email,
          isMe: false,
          role: r.role as 'to' | 'cc' | 'bcc',
        })),
        snippet: draft.contentText?.slice(0, 150) || '',
        defaultFromId: draft.sender.id,
        cachedAt: now,
        hasFullContent: true,
        folderId,
      }

      await db.threads.put(syncThread)

      // Store draft as an email
      const syncEmail: SyncEmail = {
        id: draft.id,
        threadId: null, // Standalone draft
        subject: draft.subject,
        contentText: draft.contentText || '',
        contentHtml: draft.contentHtml,
        sentAt: null,
        receivedAt: null,
        isRead: true,
        status: 'draft',
        sender: {
          id: draft.sender.id,
          name: draft.sender.name,
          email: draft.sender.email,
          isMe: true,
          role: 'from',
        },
        recipients: draft.recipients.map(r => ({
          id: r.id,
          name: r.name,
          email: r.email,
          isMe: false,
          role: r.role as 'to' | 'cc' | 'bcc',
        })),
        attachments: draft.attachments.map(a => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
          isInline: a.isInline ?? false,
        })),
        replyTo: null,
        messageId: null,
        references: null,
        inReplyTo: null,
        cachedAt: now,
        queuedAt: null,
        sendAttempts: 0,
        lastSendError: null,
      }

      await db.emails.put(syncEmail)

      // Cache small attachments
      for (const att of draft.attachments) {
        if (att.size && att.size <= SYNC_LIMITS.maxAttachmentSize) {
          await cacheAttachment(att.id)
        }
      }
    } catch (e) {
      console.error(`[Sync] Failed to fetch standalone draft ${item.id}:`, e)
    }
  } else {
    // Regular thread - fetch full details
    try {
      const detailResponse = await fetch(`/api/threads/${item.id}?markRead=false`)
      if (!detailResponse.ok) return

      const detail = await detailResponse.json() as ApiThreadDetail

      const syncThread: SyncThread = {
        id: item.id,
        type: 'thread',
        subject: detail.subject,
        createdAt: parseDate(item.createdAt) ?? now,
        replyLaterAt: detail.replyLaterAt,
        setAsideAt: detail.setAsideAt,
        latestEmailAt: parseDate(item.latestEmailAt),
        unreadCount: item.unreadCount,
        totalCount: item.totalCount,
        draftCount: item.draftCount,
        queuedCount: item.queuedCount,
        participants: item.participants.map(toSyncParticipant),
        snippet: item.snippet,
        defaultFromId: detail.defaultFromId,
        cachedAt: now,
        hasFullContent: true,
        folderId: detail.folderId ?? folderId,
      }

      await db.threads.put(syncThread)

      // Store emails
      for (const email of detail.emails) {
        const syncEmail: SyncEmail = {
          id: email.id,
          threadId: item.id,
          subject: email.subject,
          contentText: email.contentText || '',
          contentHtml: email.contentHtml,
          sentAt: email.sentAt,
          receivedAt: email.receivedAt,
          isRead: email.isRead,
          status: email.status,
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
            role: r.role as 'to' | 'cc' | 'bcc',
          })),
          attachments: email.attachments.map(a => ({
            id: a.id,
            filename: a.filename,
            mimeType: a.mimeType,
            size: a.size,
            isInline: a.isInline ?? false,
          })),
          replyTo: email.replyTo,
          messageId: email.messageId,
          references: Array.isArray(email.references) ? email.references.join(' ') : email.references,
          inReplyTo: email.inReplyTo,
          cachedAt: now,
          queuedAt: email.queuedAt ? new Date(email.queuedAt).getTime() : null,
          sendAttempts: email.sendAttempts ?? 0,
          lastSendError: email.lastSendError ?? null,
        }

        await db.emails.put(syncEmail)

        // Cache small attachments
        for (const att of email.attachments) {
          if (att.size && att.size <= SYNC_LIMITS.maxAttachmentSize) {
            await cacheAttachment(att.id)
          }
        }
      }
    } catch (e) {
      console.error(`[Sync] Failed to fetch thread ${item.id} details:`, e)
    }
  }
}

async function syncFolderThreads(folderId: number): Promise<void> {
  const db = getSyncDb()
  const now = Date.now()
  const folderName = folderId === 1 ? 'inbox' : 'junk'

  syncStatus.value[folderName] = 'syncing'

  try {
    // Fetch thread list for this folder
    const response = await fetch(`/api/threads?folderId=${folderId}&limit=${SYNC_LIMITS.threadsPerFolder}`)
    if (!response.ok) throw new Error(`Failed to fetch folder ${folderId} threads: ${response.status}`)

    const data = await response.json() as { threads: ApiThreadListItem[]; hasMore: boolean }

    // Process each thread/draft
    for (const item of data.threads) {
      await syncThreadOrDraft(item, folderId, now)
    }

    // Update sync metadata
    await db.syncMeta.put({
      key: folderName,
      lastSyncedAt: now,
      itemCount: data.threads.length,
    })

    syncStatus.value[folderName] = 'idle'
    console.log(`[Sync] Synced ${data.threads.length} ${folderName} threads/drafts`)
  } catch (e) {
    console.error(`[Sync] Failed to sync folder ${folderId}:`, e)
    syncStatus.value[folderName] = 'error'
    throw e
  }
}

async function syncReplyLaterThreads(): Promise<void> {
  const db = getSyncDb()
  const now = Date.now()

  syncStatus.value['reply_later'] = 'syncing'

  try {
    const response = await fetch(`/api/threads?queue=reply_later&limit=${SYNC_LIMITS.threadsPerFolder}`)
    if (!response.ok) throw new Error(`Failed to fetch reply later threads: ${response.status}`)

    const data = await response.json() as { threads: ApiThreadListItem[]; hasMore: boolean }

    for (const item of data.threads) {
      // Reply later threads keep their original folder
      await syncThreadOrDraft(item, item.folderId ?? 1, now)
    }

    await db.syncMeta.put({
      key: 'reply_later',
      lastSyncedAt: now,
      itemCount: data.threads.length,
    })

    syncStatus.value['reply_later'] = 'idle'
    console.log(`[Sync] Synced ${data.threads.length} reply later threads`)
  } catch (e) {
    console.error('[Sync] Failed to sync reply later:', e)
    syncStatus.value['reply_later'] = 'error'
    throw e
  }
}

async function syncSetAsideEmails(): Promise<void> {
  const db = getSyncDb()
  const now = Date.now()

  syncStatus.value['set_aside'] = 'syncing'

  try {
    const response = await fetch('/api/set-aside?limit=100')
    if (!response.ok) throw new Error(`Failed to fetch Set Aside: ${response.status}`)

    const data = await response.json() as { emails: ApiSetAsideEmail[]; hasMore: boolean }

    // Group emails by threadId
    const threadMap = new Map<number, ApiSetAsideEmail[]>()
    for (const email of data.emails) {
      const existing = threadMap.get(email.threadId) || []
      existing.push(email)
      threadMap.set(email.threadId, existing)
    }

    for (const [threadId, emails] of threadMap) {
      const firstEmail = emails[0]!
      const latestEmail = emails.reduce((a, b) => {
        const aTime = parseDate(a.sentAt) ?? 0
        const bTime = parseDate(b.sentAt) ?? 0
        return aTime > bTime ? a : b
      })

      const syncThread: SyncThread = {
        id: threadId,
        type: 'thread',
        subject: firstEmail.subject,
        createdAt: now,
        replyLaterAt: null,
        setAsideAt: now,
        latestEmailAt: parseDate(latestEmail.sentAt),
        unreadCount: emails.filter(e => !e.isRead).length,
        totalCount: emails.length,
        draftCount: 0,
        queuedCount: 0,
        participants: [],
        snippet: '',
        defaultFromId: null,
        cachedAt: now,
        hasFullContent: true,
        folderId: 1, // Set aside threads default to Inbox folder
      }

      await db.threads.put(syncThread)

      for (const email of emails) {
        const syncEmail: SyncEmail = {
          id: email.id,
          threadId,
          subject: email.subject,
          contentText: '',
          contentHtml: email.content,
          sentAt: parseDate(email.sentAt),
          receivedAt: parseDate(email.receivedAt),
          isRead: email.isRead,
          status: 'sent',
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
            role: r.role as 'to' | 'cc' | 'bcc',
          })),
          attachments: email.attachments.map(a => ({
            id: a.id,
            filename: a.filename,
            mimeType: a.mimeType,
            size: a.size,
            isInline: false,
          })),
          replyTo: null,
          messageId: null,
          references: null,
          inReplyTo: null,
          cachedAt: now,
          queuedAt: null,
          sendAttempts: 0,
          lastSendError: null,
        }

        await db.emails.put(syncEmail)

        for (const att of email.attachments) {
          if (att.size && att.size <= SYNC_LIMITS.maxAttachmentSize) {
            await cacheAttachment(att.id)
          }
        }
      }
    }

    await db.syncMeta.put({
      key: 'set_aside',
      lastSyncedAt: now,
      itemCount: threadMap.size,
    })

    syncStatus.value['set_aside'] = 'idle'
    console.log(`[Sync] Synced ${threadMap.size} Set Aside threads with ${data.emails.length} emails`)
  } catch (e) {
    console.error('[Sync] Failed to sync Set Aside:', e)
    syncStatus.value['set_aside'] = 'error'
    throw e
  }
}

// ============== Contacts Syncing ==============

async function syncContacts(): Promise<void> {
  const db = getSyncDb()
  const now = Date.now()

  syncStatus.value['contacts'] = 'syncing'

  try {
    // Fetch all contacts
    const response = await fetch('/api/contacts?all=true&limit=5000')
    if (!response.ok) throw new Error(`Failed to fetch contacts: ${response.status}`)

    const data = await response.json() as {
      contacts: ApiContact[]
      hasMore: boolean
      syncedAt?: number
    }

    // Also fetch identities
    const meResponse = await fetch('/api/contacts/me')
    const meData = meResponse.ok
      ? await meResponse.json() as { contacts: Array<{ id: number; name: string | null; email: string }> }
      : { contacts: [] }

    // Clear and re-populate
    await db.contacts.clear()

    const contacts: SyncContact[] = data.contacts.map(c => ({
      id: c.id,
      name: c.name,
      email: c.email,
      isMe: c.isMe,
      lastEmailAt: parseDate(c.lastEmailAt),
      emailCount: c.emailCount,
      cachedAt: now,
    }))

    // Add me contacts
    for (const me of meData.contacts) {
      if (!contacts.find(c => c.id === me.id)) {
        contacts.push({
          id: me.id,
          name: me.name,
          email: me.email,
          isMe: true,
          lastEmailAt: null,
          emailCount: 0,
          cachedAt: now,
        })
      }
    }

    if (contacts.length > 0) {
      await db.contacts.bulkPut(contacts)
    }

    await db.syncMeta.put({
      key: 'contacts',
      lastSyncedAt: data.syncedAt ?? now,
      itemCount: contacts.length,
    })

    syncStatus.value['contacts'] = 'idle'
    console.log(`[Sync] Synced ${contacts.length} contacts + identities`)
  } catch (e) {
    console.error('[Sync] Failed to sync contacts:', e)
    syncStatus.value['contacts'] = 'error'
    throw e
  }
}

// ============== Attachment Caching ==============

async function cacheAttachment(attachmentId: number): Promise<boolean> {
  const db = getSyncDb()

  const existing = await db.attachmentBlobs.get(attachmentId)
  if (existing) return true

  // Check total cache size
  const totalSize = await db.attachmentBlobs.toArray().then(blobs =>
    blobs.reduce((sum, b) => sum + b.size, 0)
  )

  if (totalSize >= SYNC_LIMITS.totalAttachmentCacheSize) {
    const oldest = await db.attachmentBlobs.orderBy('cachedAt').first()
    if (oldest) {
      await db.attachmentBlobs.delete(oldest.id)
    }
  }

  try {
    const response = await fetch(`/api/attachments/${attachmentId}`)
    if (!response.ok) return false

    const blob = await response.blob()

    await db.attachmentBlobs.put({
      id: attachmentId,
      blob,
      mimeType: blob.type,
      size: blob.size,
      cachedAt: Date.now(),
    })

    return true
  } catch (e) {
    console.error(`[Sync] Failed to cache attachment ${attachmentId}:`, e)
    return false
  }
}

export async function getCachedAttachmentBlob(attachmentId: number): Promise<Blob | null> {
  const db = getSyncDb()
  const record = await db.attachmentBlobs.get(attachmentId)
  return record?.blob ?? null
}

// ============== Cleanup ==============

async function cleanupUnreferencedData(): Promise<void> {
  const db = getSyncDb()

  // Get all threads
  const allThreads = await db.threads.toArray()
  const activeThreadIds = new Set(allThreads.map(t => t.id))

  // Delete emails belonging to deleted threads
  const allEmails = await db.emails.toArray()
  for (const email of allEmails) {
    if (email.threadId && !activeThreadIds.has(email.threadId)) {
      await db.emails.delete(email.id)
    }
  }

  // Clean up orphaned attachment blobs
  const remainingEmails = await db.emails.toArray()
  const activeAttachmentIds = new Set<number>()
  for (const email of remainingEmails) {
    for (const att of email.attachments) {
      activeAttachmentIds.add(att.id)
    }
  }

  const allBlobs = await db.attachmentBlobs.toArray()
  const orphanedBlobIds = allBlobs
    .filter(b => !activeAttachmentIds.has(b.id))
    .map(b => b.id)

  if (orphanedBlobIds.length > 0) {
    console.log(`[Sync] Cleaning up ${orphanedBlobIds.length} orphaned attachment blobs`)
    await db.attachmentBlobs.bulkDelete(orphanedBlobIds)
  }
}

// ============== Pending Changes Syncing ==============

async function syncPendingChanges(): Promise<void> {
  const db = getSyncDb()

  syncStatus.value['drafts'] = 'syncing'

  try {
    const pendingItems = await db.pendingSync.toArray()

    for (const item of pendingItems) {
      if (item.entityType !== 'draft') continue

      try {
        if (item.action === 'delete') {
          // Delete on server
          const response = await fetch(`/api/drafts/${item.entityId}`, { method: 'DELETE' })
          if (response.ok || response.status === 404) {
            await db.pendingSync.delete(item.id!)
            console.log(`[Sync] Deleted draft ${item.entityId}`)
          }
        } else if (item.action === 'create') {
          // Get draft data from cache
          const email = await db.emails.get(item.entityId)
          if (!email) {
            // Draft was deleted locally, remove pending entry
            await db.pendingSync.delete(item.id!)
            continue
          }

          const isReplyDraft = email.threadId !== null

          const response = await fetch('/api/drafts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              threadId: email.threadId,
              senderId: email.sender?.id,
              subject: email.subject,
              contentText: email.contentText,
              contentHtml: email.contentHtml,
              recipients: email.recipients.map(r => ({
                id: r.id || undefined,
                email: r.email,
                name: r.name,
                role: r.role,
              })),
              inReplyTo: email.inReplyTo,
              references: email.references?.split(' ').filter(Boolean),
            }),
          })

          if (response.ok) {
            const result = await response.json() as { id: number }
            const oldId = item.entityId

            // Update email with server ID
            await db.emails.delete(oldId)
            await db.emails.put({ ...email, id: result.id })

            if (!isReplyDraft) {
              // Standalone draft - update the fake thread entry
              const thread = await db.threads.get(oldId)
              await db.threads.delete(oldId)

              if (thread) {
                await db.threads.put({ ...thread, id: result.id })
              }
            }

            // Update any pending send entries that reference the old ID
            const pendingSends = await db.pendingSync
              .filter(p => p.entityType === 'draft' && p.entityId === oldId && p.action === 'send')
              .toArray()
            for (const pendingSend of pendingSends) {
              await db.pendingSync.update(pendingSend.id!, { entityId: result.id })
              // Also update in-memory items for this sync cycle
              const inMemoryItem = pendingItems.find(p => p.id === pendingSend.id)
              if (inMemoryItem) {
                inMemoryItem.entityId = result.id
              }
              console.log(`[Sync] Updated pending send entry from ${oldId} to ${result.id}`)
            }

            await db.pendingSync.delete(item.id!)
            console.log(`[Sync] Created ${isReplyDraft ? 'reply' : 'standalone'} draft ${result.id} from local ${oldId}`)
          }
        } else if (item.action === 'update') {
          // Get draft data from cache
          const email = await db.emails.get(item.entityId)
          if (!email) {
            await db.pendingSync.delete(item.id!)
            continue
          }

          const response = await fetch(`/api/drafts/${item.entityId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              senderId: email.sender?.id,
              subject: email.subject,
              contentText: email.contentText,
              contentHtml: email.contentHtml,
              recipients: email.recipients.map(r => ({
                id: r.id || undefined,
                email: r.email,
                name: r.name,
                role: r.role,
              })),
              inReplyTo: email.inReplyTo,
              references: email.references?.split(' ').filter(Boolean),
            }),
          })

          if (response.ok) {
            await db.pendingSync.delete(item.id!)
            console.log(`[Sync] Updated draft ${item.entityId}`)
          }
        } else if (item.action === 'send') {
          // Get draft data from cache
          const email = await db.emails.get(item.entityId)
          if (!email) {
            await db.pendingSync.delete(item.id!)
            continue
          }

          // Check if this is a local draft that needs to be created first
          const pendingCreate = pendingItems.find(
            p => p.entityType === 'draft' && p.entityId === item.entityId && p.action === 'create'
          )

          let serverId = item.entityId

          // If local draft, create it first
          if (isLocalId(item.entityId) || pendingCreate) {
            const isReplyDraft = email.threadId !== null

            const createResponse = await fetch('/api/drafts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                threadId: email.threadId,
                senderId: email.sender?.id,
                subject: email.subject,
                contentText: email.contentText,
                contentHtml: email.contentHtml,
                recipients: email.recipients.map(r => ({
                  id: r.id || undefined,
                  email: r.email,
                  name: r.name,
                  role: r.role,
                })),
                inReplyTo: email.inReplyTo,
                references: email.references?.split(' ').filter(Boolean),
              }),
            })

            if (!createResponse.ok) {
              console.error(`[Sync] Failed to create draft before sending ${item.entityId}`)
              continue
            }

            const result = await createResponse.json() as { id: number }
            serverId = result.id
            const oldId = item.entityId

            // Update email with server ID
            await db.emails.delete(oldId)
            await db.emails.put({ ...email, id: serverId })

            if (!isReplyDraft) {
              // Standalone draft - update the fake thread entry
              const thread = await db.threads.get(oldId)
              await db.threads.delete(oldId)

              if (thread) {
                await db.threads.put({ ...thread, id: serverId })
              }
            }

            // Remove the create pending entry if there was one
            if (pendingCreate?.id) {
              await db.pendingSync.delete(pendingCreate.id)
            }

            console.log(`[Sync] Created draft ${serverId} from local ${oldId} before sending`)
          }

          // Now queue for sending on the server
          const sendResponse = await fetch(`/api/drafts/${serverId}/send`, {
            method: 'POST',
          })

          if (sendResponse.ok) {
            const sendResult = await sendResponse.json() as { success: boolean; status: string; threadId?: number }

            // If server created a thread for a standalone draft, update local cache
            if (sendResult.threadId && !email.threadId) {
              // Update the email to point to the new thread
              await db.emails.update(serverId, { threadId: sendResult.threadId })

              // Remove the standalone draft entry from threads table
              await db.threads.delete(serverId)

              // Create a proper thread entry for the new thread
              await db.threads.put({
                id: sendResult.threadId,
                type: 'thread',
                subject: email.subject || '(No subject)',
                createdAt: Date.now(),
                replyLaterAt: null,
                setAsideAt: null,
                latestEmailAt: Date.now(),
                unreadCount: 0,
                totalCount: 1,
                draftCount: 0,
                queuedCount: 1,
                participants: email.recipients || [],
                snippet: email.contentText?.substring(0, 150) || '',
                cachedAt: Date.now(),
                defaultFromId: email.sender?.id || null,
                hasFullContent: false,
                folderId: 1, // New threads go to Inbox
              })

              console.log(`[Sync] Created thread ${sendResult.threadId} for standalone draft ${serverId}`)
            }

            await db.pendingSync.delete(item.id!)
            console.log(`[Sync] Queued draft ${serverId} for sending`)
          }
        }
      } catch (e) {
        console.error(`[Sync] Failed to sync ${item.action} for draft ${item.entityId}:`, e)
      }
    }

    syncStatus.value['drafts'] = 'idle'
    console.log(`[Sync] Processed ${pendingItems.length} pending changes`)
  } catch (e) {
    console.error('[Sync] Failed to sync pending changes:', e)
    syncStatus.value['drafts'] = 'error'
    throw e
  }
}

// ============== Orphaned Draft Cleanup ==============

async function cleanupOrphanedDrafts(): Promise<void> {
  const db = getSyncDb()

  // Get all draft IDs from cache (only server IDs, not local negative IDs)
  const draftThreads = await db.threads
    .filter(t => t.type === 'draft' && t.id > 0)
    .toArray()

  const draftEmails = await db.emails
    .filter(e => e.status === 'draft' && e.id > 0)
    .toArray()

  const allDraftIds = new Set<number>()
  for (const t of draftThreads) allDraftIds.add(t.id)
  for (const e of draftEmails) allDraftIds.add(e.id)

  if (allDraftIds.size === 0) return

  const idsToCheck = Array.from(allDraftIds)

  try {
    const response = await fetch('/api/drafts/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: idsToCheck }),
    })

    if (!response.ok) {
      console.warn('[Sync] Draft check endpoint not available, skipping orphan cleanup')
      return
    }

    const { existing } = await response.json() as { existing: number[] }
    const existingSet = new Set(existing)

    let deletedCount = 0

    // Delete orphaned draft threads
    for (const thread of draftThreads) {
      if (!existingSet.has(thread.id)) {
        await db.threads.delete(thread.id)
        deletedCount++
      }
    }

    // Delete orphaned draft emails
    for (const email of draftEmails) {
      if (!existingSet.has(email.id)) {
        await db.emails.delete(email.id)
        deletedCount++
      }
    }

    if (deletedCount > 0) {
      console.log(`[Sync] Cleaned up ${deletedCount} orphaned drafts`)
    }
  } catch (e) {
    console.warn('[Sync] Failed to cleanup orphaned drafts:', e)
  }
}

// ============== Main Sync Function ==============

export async function syncAll(): Promise<void> {
  if (isSyncing.value) {
    console.log('[Sync] Sync already in progress')
    return
  }

  isSyncing.value = true
  lastSyncError.value = null

  console.log('[Sync] Starting full sync...')

  try {
    // Cleanup orphaned drafts (ones deleted on server)
    await cleanupOrphanedDrafts()

    // Sync pending changes first (push local changes before pulling)
    await syncPendingChanges()

    // Sync folders first (we need folder info for thread syncing)
    const folders = await syncFolders()

    // Sync contacts
    await syncContacts()

    // Sync each folder's threads dynamically
    const folderSyncPromises = folders.map(f => syncFolderThreads(f.id))

    // Sync all folders and queues in parallel
    await Promise.allSettled([
      ...folderSyncPromises,
      syncReplyLaterThreads(),
      syncSetAsideEmails(),
    ])

    // Cleanup unreferenced data
    await cleanupUnreferencedData()

    console.log('[Sync] Full sync complete')
  } catch (e) {
    lastSyncError.value = e instanceof Error ? e.message : 'Sync failed'
    console.error('[Sync] Full sync failed:', e)
  } finally {
    isSyncing.value = false
  }
}

// ============== Data Retrieval Functions ==============

export async function getFolders(): Promise<SyncFolder[]> {
  const db = getSyncDb()
  return db.folders.orderBy('position').toArray()
}

export async function getThreadsForFolder(folderId: number): Promise<SyncThread[]> {
  const db = getSyncDb()
  return db.threads.filter(t => t.folderId === folderId).toArray()
}

export async function getThread(threadId: number): Promise<SyncThread | undefined> {
  const db = getSyncDb()
  return db.threads.get(threadId)
}

export async function getThreadEmails(threadId: number): Promise<SyncEmail[]> {
  const db = getSyncDb()
  return db.emails
    .where('threadId')
    .equals(threadId)
    .sortBy('sentAt')
}

export async function getStandaloneDraftEmail(draftId: number): Promise<SyncEmail | undefined> {
  const db = getSyncDb()
  // For standalone drafts, the email.id matches the "thread" id shown in UI
  return db.emails.get(draftId)
}

export async function getEmail(emailId: number): Promise<SyncEmail | undefined> {
  const db = getSyncDb()
  return db.emails.get(emailId)
}

export async function getContacts(): Promise<SyncContact[]> {
  const db = getSyncDb()
  return db.contacts.toArray()
}

export async function getMeContacts(): Promise<SyncContact[]> {
  const db = getSyncDb()
  // Use filter instead of where().equals() to avoid boolean indexing quirks
  return db.contacts.filter(c => c.isMe === true).toArray()
}

export async function searchContacts(query: string): Promise<SyncContact[]> {
  const db = getSyncDb()
  const searchTerm = query.toLowerCase().trim()

  if (searchTerm.length < 2) return []

  return db.contacts
    .filter(c => {
      const nameMatch = c.name?.toLowerCase().includes(searchTerm) ?? false
      const emailMatch = c.email.toLowerCase().includes(searchTerm)
      return nameMatch || emailMatch
    })
    .limit(20)
    .toArray()
}

export async function getSyncMeta(key: string): Promise<{ lastSyncedAt: number; itemCount: number } | null> {
  const db = getSyncDb()
  const meta = await db.syncMeta.get(key)
  return meta ? { lastSyncedAt: meta.lastSyncedAt, itemCount: meta.itemCount } : null
}

// ============== Clear Functions ==============

export async function clearSyncData(): Promise<void> {
  const db = getSyncDb()
  await db.folders.clear()
  await db.threads.clear()
  await db.emails.clear()
  await db.attachmentBlobs.clear()
  await db.contacts.clear()
  await db.syncMeta.clear()
  await db.pendingSync.clear()
}

// ============== Composable ==============

export function useSync() {
  return {
    // State
    syncStatus: readonly(syncStatus),
    lastSyncError: readonly(lastSyncError),
    isSyncing: readonly(isSyncing),

    // Actions
    syncAll,
    syncFolders,
    syncContacts,
    syncFolderThreads,
    syncSetAsideEmails,
    syncPendingChanges,
    clearSyncData,

    // Retrieval
    getFolders,
    getThreadsForFolder,
    getThread,
    getThreadEmails,
    getStandaloneDraftEmail,
    getEmail,
    getContacts,
    getMeContacts,
    searchContacts,
    getSyncMeta,
    getCachedAttachmentBlob,
  }
}
