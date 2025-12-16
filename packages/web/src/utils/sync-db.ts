import Dexie, { type EntityTable } from 'dexie'

// ============== Type Definitions ==============
// These closely match the server API response shapes

export interface SyncFolder {
  id: number
  name: string
  imapFolder: string | null
  position: number
  cachedAt: number
}

export interface SyncContact {
  id: number
  name: string | null
  email: string
  isMe: boolean
  lastEmailAt: number | null
  emailCount: number
  cachedAt: number
}

export interface SyncParticipant {
  id: number
  name: string | null
  email: string
  isMe: boolean
  role: 'from' | 'to' | 'cc' | 'bcc'
}

export interface SyncAttachmentMeta {
  id: number
  filename: string
  mimeType: string | null
  size: number | null
  isInline: boolean
}

export interface SyncEmail {
  id: number
  threadId: number | null  // null for standalone drafts
  subject: string
  contentText: string
  contentHtml: string | null
  sentAt: number | null
  receivedAt: number | null
  isRead: boolean
  status: 'draft' | 'queued' | 'sent' | 'received'
  sender: SyncParticipant | null
  recipients: SyncParticipant[]
  attachments: SyncAttachmentMeta[]
  replyTo: string | null
  messageId: string | null
  references: string | null
  inReplyTo: string | null
  cachedAt: number
  // Send queue tracking
  queuedAt: number | null
  sendAttempts: number
  lastSendError: string | null
}

export interface SyncThread {
  id: number
  type: 'thread' | 'draft'  // 'draft' = standalone draft without thread
  subject: string
  createdAt: number
  replyLaterAt: number | null
  setAsideAt: number | null
  latestEmailAt: number | null
  unreadCount: number
  totalCount: number
  draftCount: number
  queuedCount: number
  participants: SyncParticipant[]
  snippet: string
  defaultFromId: number | null
  cachedAt: number
  hasFullContent: boolean
  folderId: number | null  // 1=Inbox, 2=Junk
}

export interface SyncAttachmentBlob {
  id: number  // Server attachment ID
  blob: Blob
  mimeType: string
  size: number
  cachedAt: number
}

export interface SyncMeta {
  key: string  // e.g., 'approved', 'feed', 'reply_later', 'contacts'
  lastSyncedAt: number
  itemCount: number
}

// Pending sync actions for offline support
// Only tracks WHAT needs syncing - actual content is in threads/emails tables
export interface PendingSync {
  id?: number  // Auto-increment
  entityType: 'draft'  // For now just drafts, could expand later
  entityId: number  // ID in threads/emails table (negative for local-only)
  action: 'create' | 'update' | 'delete' | 'send'
  createdAt: number
}

// ============== Database Class ==============

class SyncDatabase extends Dexie {
  folders!: EntityTable<SyncFolder, 'id'>
  contacts!: EntityTable<SyncContact, 'id'>
  threads!: EntityTable<SyncThread, 'id'>
  emails!: EntityTable<SyncEmail, 'id'>
  attachmentBlobs!: EntityTable<SyncAttachmentBlob, 'id'>
  syncMeta!: EntityTable<SyncMeta, 'key'>
  pendingSync!: EntityTable<PendingSync, 'id'>

  constructor() {
    super('MereMail')

    this.version(6).stores({
      // Folders: basic metadata
      folders: 'id, position',

      // Contacts: simplified, no bucket
      contacts: 'id, email, isMe, cachedAt',

      // Threads: index by folderId for folder filtering
      threads: 'id, type, folderId, latestEmailAt, replyLaterAt, setAsideAt, cachedAt',

      // Emails: index by threadId (null for standalone drafts)
      emails: 'id, threadId, sentAt, status, cachedAt',

      // Bucket membership: removed (no longer needed)
      bucketMembership: null,

      // Attachment binary data
      attachmentBlobs: 'id, cachedAt, size',

      // Sync metadata
      syncMeta: 'key',

      // Pending sync actions (replaces pendingDrafts)
      pendingSync: '++id, entityType, entityId, action',
    })
  }
}

// ============== Singleton Instance ==============

let db: SyncDatabase | null = null

export function getSyncDb(): SyncDatabase {
  if (!db) {
    db = new SyncDatabase()
  }
  return db
}

// ============== Constants ==============

export const SYNC_LIMITS = {
  // Thread limits per folder
  threadsPerFolder: 25,
  // Max attachment size to cache (10 MB)
  maxAttachmentSize: 10 * 1024 * 1024,
  // Total attachment cache limit (100 MB)
  totalAttachmentCacheSize: 100 * 1024 * 1024,
} as const

// Generate a local ID for offline-created drafts
// Uses negative numbers to distinguish from server IDs
let nextLocalId = -1

export async function generateLocalDraftId(): Promise<number> {
  const db = getSyncDb()

  // Find the lowest existing ID to avoid collisions
  const lowestThread = await db.threads.orderBy('id').first()
  const lowestEmail = await db.emails.orderBy('id').first()

  const lowestExisting = Math.min(
    lowestThread?.id ?? 0,
    lowestEmail?.id ?? 0,
    nextLocalId
  )

  // Use one less than the lowest
  nextLocalId = Math.min(lowestExisting - 1, nextLocalId - 1)
  return nextLocalId
}

// Check if an ID is a local (not-yet-synced) ID
export function isLocalId(id: number): boolean {
  return id < 0
}
