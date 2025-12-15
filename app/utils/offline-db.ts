import Dexie, { type EntityTable } from 'dexie'

// ============== Type Definitions ==============

export interface OfflineContact {
  id: number
  name: string | null
  email: string
  bucket: string | null
  isMe: boolean
  cachedAt: number
}

export interface CRDTField<T> {
  value: T
  updatedAt: number
}

export interface OfflineRecipient {
  id?: number
  email: string
  name?: string | null
  role: 'to' | 'cc' | 'bcc'
}

export interface OfflineAttachment {
  localId: string
  serverId?: number
  filename: string
  mimeType: string
  size: number
  isInline: boolean
  blobKey?: string  // Reference to attachmentBlobs table
  serverUrl?: string
}

export interface OfflineDraft {
  localId: string  // UUID, primary key
  serverId?: number
  threadId?: number
  senderId: number
  subject: CRDTField<string>
  contentText: CRDTField<string>
  contentHtml: CRDTField<string | null>
  recipients: CRDTField<OfflineRecipient[]>
  attachments: OfflineAttachment[]
  createdAt: number
  syncedAt?: number
}

export interface OfflineParticipant {
  id: number
  name: string | null
  email: string
  isMe?: boolean
  role: string
}

export interface OfflineThread {
  id: number
  type: 'thread' | 'draft'
  subject: string
  latestEmailAt: number | null
  unreadCount: number
  totalCount: number
  draftCount: number
  participants: OfflineParticipant[]
  snippet: string
  cachedAt: number
}

export interface OfflineEmail {
  id: number
  threadId: number
  subject: string
  contentText: string
  contentHtml: string | null
  sentAt: number | null
  status: 'draft' | 'sent'
  sender: OfflineParticipant | null
  recipients: OfflineParticipant[]
  attachmentIds: number[]
  cachedAt: number
}

export interface CachedThread {
  id: number
  cacheType: 'setAside' | 'replyLater'
  subject: string
  replyLaterAt: number | null
  setAsideAt: number | null
  emails: OfflineEmail[]
  cachedAt: number
}

export interface AttachmentBlob {
  id: number  // Attachment server ID
  cacheType: 'setAside' | 'replyLater' | 'draft'
  blob: Blob
  size: number
  cachedAt: number
}

export interface SyncQueueItem {
  id?: number  // Auto-increment
  type: 'draft-create' | 'draft-update' | 'draft-delete' | 'attachment-upload'
  payload: unknown
  createdAt: number
  retryCount: number
  lastError?: string
}

export interface CacheMeta {
  key: string  // e.g., 'contacts', 'setAside', 'replyLater', 'inbox'
  cachedAt: number
  expiresAt: number
  sizeBytes: number
  itemCount: number
}

// ============== Database Class ==============

class OfflineDatabase extends Dexie {
  contacts!: EntityTable<OfflineContact, 'id'>
  drafts!: EntityTable<OfflineDraft, 'localId'>
  threads!: EntityTable<OfflineThread, 'id'>  // Inbox top 20
  cachedThreads!: EntityTable<CachedThread, 'id'>  // Set Aside / Reply Later
  attachmentBlobs!: EntityTable<AttachmentBlob, 'id'>
  syncQueue!: EntityTable<SyncQueueItem, 'id'>
  cacheMeta!: EntityTable<CacheMeta, 'key'>

  constructor() {
    super('MereMail')

    this.version(1).stores({
      // Contacts: searchable by email and name
      contacts: 'id, email, name, bucket, isMe, cachedAt',

      // Drafts: primary key is localId (UUID), index by serverId for lookups
      drafts: 'localId, serverId, threadId, createdAt, syncedAt',

      // Inbox threads (top 20 cache)
      threads: 'id, latestEmailAt, cachedAt',

      // Set Aside / Reply Later cached threads with full content
      cachedThreads: 'id, cacheType, cachedAt',

      // Attachment binary data
      attachmentBlobs: 'id, cacheType, cachedAt, size',

      // Sync queue for offline operations
      syncQueue: '++id, type, createdAt',

      // Cache metadata for size tracking and expiry
      cacheMeta: 'key',
    })
  }
}

// ============== Singleton Instance ==============

let db: OfflineDatabase | null = null

export function getOfflineDb(): OfflineDatabase {
  if (!db) {
    db = new OfflineDatabase()
  }
  return db
}

// ============== Helper Functions ==============

export function generateLocalId(): string {
  return crypto.randomUUID()
}

export function createCRDTField<T>(value: T): CRDTField<T> {
  return { value, updatedAt: Date.now() }
}

export function mergeCRDTField<T>(local: CRDTField<T>, remote: CRDTField<T>): CRDTField<T> {
  return local.updatedAt >= remote.updatedAt ? local : remote
}

// ============== Cache Size Constants ==============

export const CACHE_LIMITS = {
  setAside: 20 * 1024 * 1024,     // 20 MB
  replyLater: 20 * 1024 * 1024,  // 20 MB
  inboxThreads: 20,               // 20 threads
  contactsMaxAge: 24 * 60 * 60 * 1000,  // 24 hours
} as const
