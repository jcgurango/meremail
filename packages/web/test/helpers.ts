import type { SyncThread, SyncEmail, SyncFolder, SyncParticipant, SyncConfig } from '@meremail/shared/sync-types'
import { db } from '@/local/db'

export const DAY = 24 * 60 * 60 * 1000

export const CONFIG: SyncConfig = { imageProxyUrl: '', maxAttachmentSize: 1000, windowDays: 30 }

export const FOLDERS: SyncFolder[] = [
  { id: 1, name: 'Inbox', imapFolder: 'INBOX', position: 0, isSystem: true, notificationsEnabled: true, showUnreadCount: true, syncOffline: true },
  { id: 2, name: 'Junk', imapFolder: 'Junk', position: 1, isSystem: true, notificationsEnabled: false, showUnreadCount: false, syncOffline: false },
  { id: 3, name: 'Trash', imapFolder: null, position: 2, isSystem: true, notificationsEnabled: false, showUnreadCount: false, syncOffline: false },
]

export const ME: SyncParticipant = { id: 1, name: 'Me', email: 'me@example.com', isMe: true, role: 'to' }
export const ALICE: SyncParticipant = { id: 2, name: 'Alice', email: 'alice@example.com', isMe: false, role: 'from' }

export async function resetDb(): Promise<void> {
  await db.delete()
  await db.open()
}

let nextEmailId = 1000

export function makeThread(id: number, overrides: Partial<SyncThread> = {}): SyncThread {
  return {
    id,
    subject: `Thread ${id}`,
    folderId: 1,
    previousFolderId: null,
    trashedAt: null,
    replyLaterAt: null,
    setAsideAt: null,
    createdAt: Date.now(),
    latestAt: Date.now(),
    ...overrides,
  }
}

export function makeEmail(threadId: number, overrides: Partial<SyncEmail> = {}): SyncEmail {
  const id = overrides.id ?? nextEmailId++
  const date = overrides.date ?? Date.now()
  return {
    id,
    threadId,
    folderId: 1,
    messageId: `<${id}@example.com>`,
    inReplyTo: null,
    references: [],
    subject: `Email ${id}`,
    contentText: `Body of ${id}`,
    contentHtml: null,
    replyTo: null,
    sentAt: date,
    receivedAt: date,
    date,
    readAt: null,
    status: 'sent',
    queuedAt: null,
    sendAttempts: 0,
    lastSendError: null,
    sender: ALICE,
    recipients: [ME],
    attachments: [],
    ...overrides,
  }
}
