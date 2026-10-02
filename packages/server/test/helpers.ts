import { Hono } from 'hono'
import { resolve } from 'path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db, sqlite, importEmail } from '@meremail/shared'
import type { ImportableEmail, SyncAction, SyncActionPayloads, SyncActionType } from '@meremail/shared'
import { randomUUID } from 'crypto'
import { syncRoutes, draftAttachmentsRoutes } from '../src/routes/sync'

export const ME = { email: 'me@example.com', name: 'Me' }

export function setupDatabase(): void {
  migrate(db, { migrationsFolder: resolve(__dirname, '../../shared/src/db/migrations') })
}

export function createApp(): Hono {
  const app = new Hono()
  app.route('/api/sync', syncRoutes)
  app.route('/api/draft-attachments', draftAttachmentsRoutes)
  return app
}

let counter = 0

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

/** Import an email as if it had arrived from IMAP */
export async function receive(overrides: Partial<ImportableEmail> = {}): Promise<{ id: number; threadId: number }> {
  counter++
  const messageId = overrides.messageId ?? `<test-${counter}@example.com>`
  await importEmail({
    messageId,
    references: [],
    from: { email: 'alice@example.com', name: 'Alice' },
    to: [ME],
    cc: [],
    bcc: [],
    deliveredTo: ME.email,
    subject: `Subject ${counter}`,
    textContent: `Body ${counter}`,
    sentAt: new Date(),
    receivedAt: new Date(),
    isRead: false,
    isSent: false,
    isJunk: false,
    attachments: [],
    headers: [],
    ...overrides,
  })

  return sqlite
    .prepare('SELECT id, thread_id AS threadId FROM emails WHERE message_id = ?')
    .get(messageId) as { id: number; threadId: number }
}

export function action<K extends SyncActionType>(type: K, payload: SyncActionPayloads[K]): SyncAction {
  return { id: randomUUID(), type, payload } as SyncAction
}

export function meContactId(): number {
  return (sqlite.prepare('SELECT id FROM contacts WHERE email = ?').get(ME.email) as { id: number }).id
}
