import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const folders = sqliteTable('folders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  imapFolder: text('imap_folder'), // IMAP folder to sync from (e.g., "INBOX", "Junk")
  position: integer('position').notNull().default(0),
  // System folders (Inbox, Junk, Trash) cannot be deleted or renamed
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  // Folder options
  notificationsEnabled: integer('notifications_enabled', { mode: 'boolean' }).notNull().default(false),
  showUnreadCount: integer('show_unread_count', { mode: 'boolean' }).notNull().default(true),
  syncOffline: integer('sync_offline', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})
