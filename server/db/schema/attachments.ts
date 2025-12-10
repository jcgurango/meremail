import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { emails } from './emails'

export const attachments = sqliteTable('attachments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  emailId: integer('email_id').notNull().references(() => emails.id),
  filename: text('filename').notNull(),
  mimeType: text('mime_type'),
  size: integer('size'),
  filePath: text('file_path').notNull(),
  contentId: text('content_id'),  // For CID references in HTML (e.g., "image001@example.com")
  isInline: integer('is_inline', { mode: 'boolean' }).notNull().default(false),  // True if embedded in HTML
  extractedText: text('extracted_text'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})
