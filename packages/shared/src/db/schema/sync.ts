import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// Single-row table holding the global change sequence. Triggers increment
// seq on every change to a synced table and stamp it on the changed row.
export const syncState = sqliteTable('sync_state', {
  id: integer('id').primaryKey(),
  seq: integer('seq').notNull().default(0),
  // Highest rev among pruned tombstones - a client whose cursor is older
  // than this has missed deletions and must start over
  tombstoneFloor: integer('tombstone_floor').notNull().default(0),
})

// Record of hard-deleted rows, written by triggers
export const tombstones = sqliteTable('tombstones', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  entity: text('entity').notNull(),  // Table name
  entityId: text('entity_id').notNull(),
  rev: integer('rev').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

// Client actions already applied, keyed by the client-generated action ID,
// so a retried batch is not applied twice
export const appliedActions = sqliteTable('applied_actions', {
  id: text('id').primaryKey(),
  result: text('result', { mode: 'json' }).$type<{ ok: boolean; error?: string }>().notNull(),
  appliedAt: integer('applied_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})
