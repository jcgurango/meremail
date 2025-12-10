import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core'
import { emailThreads } from './email-threads'
import { emails } from './emails'

export const contacts = sqliteTable('contacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name'),
  email: text('email').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

export const emailThreadContacts = sqliteTable('email_thread_contacts', {
  threadId: integer('thread_id').notNull().references(() => emailThreads.id),
  contactId: integer('contact_id').notNull().references(() => contacts.id),
  role: text('role', { enum: ['sender', 'recipient'] }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.threadId, table.contactId, table.role] }),
])

export const emailContacts = sqliteTable('email_contacts', {
  emailId: integer('email_id').notNull().references(() => emails.id),
  contactId: integer('contact_id').notNull().references(() => contacts.id),
  role: text('role', { enum: ['from', 'to', 'cc', 'bcc'] }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.emailId, table.contactId, table.role] }),
])
