import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { contacts } from './contacts'
import { folders } from './folders'

export const emailThreads = sqliteTable('email_threads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  subject: text('subject').notNull(),
  // Creator = sender of the first (oldest) email in thread - for fast inbox filtering
  creatorId: integer('creator_id').references(() => contacts.id),
  // Folder this thread belongs to (Inbox, Junk, etc.)
  folderId: integer('folder_id').references(() => folders.id),
  // Previous folder before trashing (for restore)
  previousFolderId: integer('previous_folder_id').references(() => folders.id),
  // Trash timestamp - NULL = not trashed, timestamp = when trashed (for 30-day retention)
  trashedAt: integer('trashed_at', { mode: 'timestamp' }),
  // Reply Later queue - NULL = not in queue, timestamp = when added (sorted oldest first)
  replyLaterAt: integer('reply_later_at', { mode: 'timestamp' }),
  // Set Aside queue - NULL = not in queue, timestamp = when added (sorted newest first)
  setAsideAt: integer('set_aside_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})
