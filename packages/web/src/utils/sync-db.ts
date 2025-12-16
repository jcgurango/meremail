import Dexie, { type EntityTable } from 'dexie'

// ============== Type Definitions ==============
// These closely match the server API response shapes

export type Bucket = 'approved' | 'feed' | 'paper_trail' | 'blocked' | 'quarantine' | 'reply_later'
export type SyncBucketType = Bucket | 'set_aside'

export interface SyncContact {
  id: number
  name: string | null
  email: string
  bucket: Bucket | null
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
  participants: SyncParticipant[]
  snippet: string
  defaultFromId: number | null
  cachedAt: number
  hasFullContent: boolean
}

// Bucket membership - a thread can belong to multiple buckets
export interface SyncBucketMembership {
  id?: number  // Auto-increment
  bucket: SyncBucketType
  threadId: number
  // For sorting within bucket
  sortKey: number  // latestEmailAt for inbox, replyLaterAt for reply_later, etc.
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
  contacts!: EntityTable<SyncContact, 'id'>
  threads!: EntityTable<SyncThread, 'id'>
  emails!: EntityTable<SyncEmail, 'id'>
  bucketMembership!: EntityTable<SyncBucketMembership, 'id'>
  attachmentBlobs!: EntityTable<SyncAttachmentBlob, 'id'>
  syncMeta!: EntityTable<SyncMeta, 'key'>
  pendingSync!: EntityTable<PendingSync, 'id'>

  constructor() {
    super('MereMail')

    this.version(4).stores({
      // Contacts: index by bucket for filtering
      contacts: 'id, email, bucket, isMe, cachedAt',

      // Threads: no bucket field, just core data
      threads: 'id, type, latestEmailAt, replyLaterAt, setAsideAt, cachedAt',

      // Emails: index by threadId (null for standalone drafts)
      emails: 'id, threadId, sentAt, status, cachedAt',

      // Bucket membership: auto-increment id, unique constraint on [bucket+threadId]
      bucketMembership: '++id, [bucket+threadId], bucket, threadId',

      // Attachment binary data
      attachmentBlobs: 'id, cachedAt, size',

      // Sync metadata
      syncMeta: 'key',

      // Pending sync actions (replaces pendingDrafts)
      pendingSync: '++id, entityType, entityId, action',
    }).upgrade(tx => {
      // Drop the old pendingDrafts table data (schema change handles table)
      return tx.table('pendingDrafts').clear().catch(() => {
        // Table might not exist, that's fine
      })
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
  // Thread limits per bucket
  threadsPerBucket: 25,
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
