import Dexie, { type EntityTable, type Table } from 'dexie'
import type {
  SyncFolder,
  SyncContact,
  SyncThread,
  SyncEmail,
  SyncParticipant,
  SyncDraft,
  SyncDraftAttachment,
  SyncAction,
  SyncConfig,
  SyncCounts,
} from '@meremail/shared/sync-types'

// ============== Row types ==============
// Server shapes plus what this device tracks or derives itself

export type LocalFolder = SyncFolder
export type LocalContact = SyncContact

export interface LocalThread extends SyncThread {
  /** When this device last retrieved the thread - it is kept for 30 days from then */
  retrievedAt: number
  // Derived from the thread's emails whenever they change
  unreadCount: number
  totalCount: number
  queuedCount: number
  snippet: string
  /** Everyone in the thread other than me */
  participants: SyncParticipant[]
}

export interface LocalEmail extends SyncEmail {
  /** 1 if unread - IndexedDB can't index booleans */
  unread: 0 | 1
}

export interface LocalDraftAttachment extends SyncDraftAttachment {
  /** True until the file has been uploaded */
  pending?: boolean
}

export interface LocalDraft extends Omit<SyncDraft, 'attachments'> {
  attachments: LocalDraftAttachment[]
  /** True once Send has been pressed, until the server confirms */
  sending?: boolean
}

/** Uploading a draft attachment is queued like any other action, but handled by the client */
export interface UploadAction {
  id: string
  type: 'draft.upload'
  payload: {
    draftId: string
    attachmentId: string
    filename: string
    mimeType: string
    size: number
    isInline: boolean
  }
}

export type LocalAction = SyncAction | UploadAction

export type PendingAction = LocalAction & {
  /** Queue position */
  seq?: number
  createdAt: number
  attempts: number
  lastError?: string
}

/** An action the server refused, kept so the user can be told */
export interface FailedAction {
  seq?: number
  type: LocalAction['type']
  error: string
  failedAt: number
  /** Short description of what the action was acting on */
  subject: string
}

export interface StoredFile {
  key: string
  blob: Blob
}

export interface MetaValues {
  /** Server change cursor - undefined until the first sync */
  cursor: number
  lastSyncedAt: number
  config: SyncConfig
  /** Unread thread counts from the server, as of lastSyncedAt */
  counts: SyncCounts
  /** Local unread thread counts at the moment `counts` was received */
  countsBaseline: Record<number, number>
  /** Everything received since this time is held locally (unless evicted) */
  floor: number
  /** Per folder: threads at or after this date are all held locally */
  watermarks: Record<number, number>
  /** Threads still to fetch from an interrupted bootstrap */
  bootstrapQueue: number[]
}

interface MetaRow {
  key: string
  value: unknown
}

// ============== Database ==============

class LocalDatabase extends Dexie {
  folders!: EntityTable<LocalFolder, 'id'>
  contacts!: EntityTable<LocalContact, 'id'>
  threads!: EntityTable<LocalThread, 'id'>
  emails!: EntityTable<LocalEmail, 'id'>
  drafts!: EntityTable<LocalDraft, 'id'>
  actions!: Table<PendingAction, number>
  failures!: Table<FailedAction, number>
  meta!: EntityTable<MetaRow, 'key'>
  files!: EntityTable<StoredFile, 'key'>

  constructor() {
    super('meremail-local')

    this.version(1).stores({
      folders: 'id, position',
      contacts: 'id, email',
      threads: 'id, folderId, [folderId+latestAt], replyLaterAt, setAsideAt, retrievedAt',
      emails: 'id, threadId, messageId, unread',
      drafts: 'id, threadId',
      // Ordered queue of mutations waiting to reach the server
      actions: '++seq, id',
      failures: '++seq',
      meta: 'key',
      // Fallback file storage for browsers without OPFS
      files: 'key',
    })
  }
}

export const db = new LocalDatabase()

// The previous offline cache lived in its own database; it is no longer used
Dexie.delete('MereMail').catch(() => {})

// ============== Meta helpers ==============

export async function getMeta<K extends keyof MetaValues>(key: K): Promise<MetaValues[K] | undefined> {
  const row = await db.meta.get(key)
  return row?.value as MetaValues[K] | undefined
}

export async function setMeta<K extends keyof MetaValues>(key: K, value: MetaValues[K]): Promise<void> {
  await db.meta.put({ key, value })
}

export async function deleteMeta(key: keyof MetaValues): Promise<void> {
  await db.meta.delete(key)
}
