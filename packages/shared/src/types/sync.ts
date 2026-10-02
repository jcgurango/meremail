/**
 * Sync protocol types, shared by the server and the web client.
 *
 * This file must stay free of runtime imports and Node types - the web
 * client imports it directly.
 *
 * All timestamps are epoch milliseconds.
 */

// ============== Entities ==============

export interface SyncFolder {
  id: number
  name: string
  imapFolder: string | null
  position: number
  isSystem: boolean
  notificationsEnabled: boolean
  showUnreadCount: boolean
  syncOffline: boolean
}

export interface SyncContact {
  id: number
  name: string | null
  email: string
  isMe: boolean
  isDefaultIdentity: boolean
}

export type ParticipantRole = 'from' | 'to' | 'cc' | 'bcc'

export interface SyncParticipant {
  id: number
  name: string | null
  email: string
  isMe: boolean
  role: ParticipantRole
}

export interface SyncAttachment {
  id: number
  filename: string
  mimeType: string | null
  size: number | null
  isInline: boolean
  contentId: string | null
}

export interface SyncThread {
  id: number
  subject: string
  folderId: number | null
  previousFolderId: number | null
  trashedAt: number | null
  replyLaterAt: number | null
  setAsideAt: number | null
  createdAt: number
  /** Date of the newest email in the thread - what thread lists sort by */
  latestAt: number | null
}

export interface SyncEmail {
  id: number
  threadId: number
  /** Folder of the owning thread, so a client can decide whether to keep it */
  folderId: number | null
  messageId: string | null
  inReplyTo: string | null
  references: string[]
  subject: string
  contentText: string
  contentHtml: string | null
  /** Raw Reply-To header value, if any */
  replyTo: string | null
  sentAt: number | null
  receivedAt: number | null
  /** receivedAt, falling back to sentAt / queuedAt / createdAt */
  date: number
  readAt: number | null
  status: 'queued' | 'sent'
  queuedAt: number | null
  sendAttempts: number
  lastSendError: string | null
  sender: SyncParticipant | null
  recipients: SyncParticipant[]
  attachments: SyncAttachment[]
}

/** Read-state change for an email whose content the client already has */
export interface SyncEmailMeta {
  id: number
  threadId: number
  readAt: number | null
}

/** An email that changed but is too old to push - refetch its thread if held */
export interface SyncEmailRef {
  id: number
  threadId: number
}

export interface SyncDraftRecipient {
  contactId?: number
  email: string
  name: string | null
  role: 'to' | 'cc' | 'bcc'
}

export interface SyncDraftAttachment {
  id: string
  filename: string
  mimeType: string | null
  size: number | null
  isInline: boolean
}

export interface SyncDraft {
  id: string
  threadId: number | null
  senderId: number
  subject: string
  contentText: string
  contentHtml: string | null
  inReplyTo: string | null
  forwardedMessageId: string | null
  references: string[]
  recipients: SyncDraftRecipient[]
  attachments: SyncDraftAttachment[]
  createdAt: number
  updatedAt: number
}

/** Draft content as sent by a client. Attachments are uploaded separately. */
export type SyncDraftInput = Omit<SyncDraft, 'attachments' | 'createdAt' | 'updatedAt'>

export interface SyncCounts {
  /** Number of threads with unread mail, by folder ID */
  folders: Record<number, number>
}

export interface SyncConfig {
  /** Image proxy URL template with a {url} placeholder; empty to disable */
  imageProxyUrl: string
  maxAttachmentSize: number
  /** Mail received within this many days is pushed to clients */
  windowDays: number
}

export type SyncEntity = 'folders' | 'contacts' | 'email_threads' | 'emails' | 'drafts' | 'email_rules'

export interface SyncDeletion {
  entity: SyncEntity
  id: string
}

// ============== Responses ==============

export interface BootstrapResponse {
  /** Pass to /changes to pick up everything after this snapshot */
  cursor: number
  serverTime: number
  config: SyncConfig
  folders: SyncFolder[]
  contacts: SyncContact[]
  drafts: SyncDraft[]
  /** Threads to fetch via /threads, newest first */
  threadIds: number[]
  counts: SyncCounts
}

export type ChangesResponse =
  | { reset: true }
  | {
      reset?: false
      cursor: number
      hasMore: boolean
      serverTime: number
      config: SyncConfig
      folders: SyncFolder[]
      contacts: SyncContact[]
      threads: SyncThread[]
      emails: SyncEmail[]
      emailMeta: SyncEmailMeta[]
      emailRefs: SyncEmailRef[]
      drafts: SyncDraft[]
      deleted: SyncDeletion[]
      /** Only present on the last page */
      counts?: SyncCounts
    }

export interface ThreadsResponse {
  threads: SyncThread[]
  emails: SyncEmail[]
  /** Requested IDs that no longer exist */
  missing: number[]
}

export interface FolderPageResponse {
  threads: SyncThread[]
  emails: SyncEmail[]
  hasMore: boolean
  /** Pass as `before` for the next page */
  nextBefore: number | null
}

// ============== Actions ==============

export interface SyncActionPayloads {
  'thread.move': { threadId: number; folderId: number }
  'thread.trash': { threadId: number }
  'thread.restore': { threadId: number }
  'thread.delete': { threadId: number }
  'thread.replyLater': { threadId: number; value: boolean }
  'thread.setAside': { threadId: number; value: boolean }
  'emails.markRead': { emailIds: number[] }
  'folder.markAllRead': { folderId: number }
  'email.delete': { emailId: number }
  'draft.save': { draft: SyncDraftInput }
  'draft.delete': { draftId: string }
  'draft.removeAttachment': { draftId: string; attachmentId: string }
  'draft.send': { draft: SyncDraftInput; messageId: string }
}

export type SyncActionType = keyof SyncActionPayloads

/** A client mutation. `id` is a client-generated UUID used for idempotency. */
export type SyncAction = {
  [K in SyncActionType]: { id: string; type: K; payload: SyncActionPayloads[K] }
}[SyncActionType]

export interface SyncActionResult {
  id: string
  ok: boolean
  /** Why the action was not applied */
  error?: string
  /**
   * True if the failure was unexpected and the action may succeed later.
   * The server stops at the first such action, so later ones in the batch
   * have no result and should be resent with it.
   */
  retry?: boolean
}

export interface ActionsResponse {
  results: SyncActionResult[]
}

export const TRASH_FOLDER_ID = 3
export const INBOX_FOLDER_ID = 1
