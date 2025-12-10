import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { emailThreads } from './email-threads'

export const emails = sqliteTable('emails', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  threadId: integer('thread_id').notNull().references(() => emailThreads.id),
  senderId: integer('sender_id').notNull(),
  messageId: text('message_id').unique(),
  inReplyTo: text('in_reply_to'),
  references: text('references', { mode: 'json' }).$type<string[]>(),
  folder: text('folder').notNull().default('INBOX'),
  isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
  subject: text('subject').notNull(),
  headers: text('headers', { mode: 'json' }).$type<Record<string, string>>(),
  content: text('content').notNull(),
  sentAt: integer('sent_at', { mode: 'timestamp' }),
  receivedAt: integer('received_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})
