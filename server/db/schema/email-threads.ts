import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { contacts } from './contacts'

export const emailThreads = sqliteTable('email_threads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  subject: text('subject').notNull(),
  // Creator = sender of the first (oldest) email in thread - for fast inbox filtering
  creatorId: integer('creator_id').references(() => contacts.id),
  // Reply Later queue - threads tagged for follow-up
  replyLater: integer('reply_later', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})
