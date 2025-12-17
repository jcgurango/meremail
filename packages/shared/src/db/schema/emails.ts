import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { emailThreads } from './email-threads'

// Email status: 'draft' for unsent, 'queued' for pending send, 'sent' for sent/received emails
export type EmailStatus = 'draft' | 'queued' | 'sent'

export const emails = sqliteTable('emails', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  threadId: integer('thread_id').references(() => emailThreads.id),  // Nullable for standalone drafts
  senderId: integer('sender_id').notNull(),
  messageId: text('message_id').unique(),
  inReplyTo: text('in_reply_to'),
  references: text('references', { mode: 'json' }).$type<string[]>(),
  folder: text('folder').notNull().default('INBOX'),
  readAt: integer('read_at', { mode: 'timestamp' }),
  status: text('status').$type<EmailStatus>().notNull().default('sent'),
  subject: text('subject').notNull(),
  headers: text('headers', { mode: 'json' }).$type<{ key: string, value: string }[]>(),
  contentText: text('content_text').notNull(),
  contentHtml: text('content_html'),
  sentAt: integer('sent_at', { mode: 'timestamp' }),
  receivedAt: integer('received_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  // Send queue tracking
  queuedAt: integer('queued_at', { mode: 'timestamp' }),
  sendAttempts: integer('send_attempts').default(0),
  lastSendError: text('last_send_error'),
  lastSendAttemptAt: integer('last_send_attempt_at', { mode: 'timestamp' }),
  // Pending recipients (email-only, not yet created as contacts)
  // Stored as JSON array: [{email: string, name: string | null, role: 'to'|'cc'|'bcc'}]
  pendingRecipients: text('pending_recipients', { mode: 'json' }).$type<Array<{
    email: string
    name: string | null
    role: 'to' | 'cc' | 'bcc'
  }>>(),
  // Trash timestamp - NULL = not trashed, timestamp = when trashed (for 30-day retention)
  trashedAt: integer('trashed_at', { mode: 'timestamp' }),
})
