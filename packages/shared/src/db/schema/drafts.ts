import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export interface DraftRecipient {
  /** Contact ID if the recipient is a known contact */
  contactId?: number
  email: string
  name: string | null
  role: 'to' | 'cc' | 'bcc'
}

// Unsent messages. IDs are client-generated UUIDs so a draft can be created
// offline and keep the same identity once it reaches the server.
export const drafts = sqliteTable('drafts', {
  id: text('id').primaryKey(),
  // Thread being replied to / forwarded from - NULL for a new message
  threadId: integer('thread_id'),
  senderId: integer('sender_id').notNull(),
  subject: text('subject').notNull().default(''),
  contentText: text('content_text').notNull().default(''),
  contentHtml: text('content_html'),
  inReplyTo: text('in_reply_to'),
  forwardedMessageId: text('forwarded_message_id'),  // Message ID of the email being forwarded
  references: text('references', { mode: 'json' }).$type<string[]>(),
  recipients: text('recipients', { mode: 'json' }).notNull().$type<DraftRecipient[]>(),
  rev: integer('rev').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

// Files attached to a draft. Moved into attachments when the draft is sent.
export const draftAttachments = sqliteTable('draft_attachments', {
  id: text('id').primaryKey(),  // Client-generated UUID
  draftId: text('draft_id').notNull(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type'),
  size: integer('size'),
  filePath: text('file_path').notNull(),
  isInline: integer('is_inline', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})
