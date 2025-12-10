import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const senderAddresses = sqliteTable('sender_addresses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})
