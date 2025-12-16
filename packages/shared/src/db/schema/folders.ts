import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const folders = sqliteTable('folders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  imapFolder: text('imap_folder'), // IMAP folder to sync from (e.g., "INBOX", "Junk")
  position: integer('position').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})
