import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const emailRules = sqliteTable('email_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  // JSON ConditionGroup - nested AND/OR groups of conditions
  conditions: text('conditions', { mode: 'json' }).notNull().$type<ConditionGroup>(),
  // Action to take when rule matches
  actionType: text('action_type').$type<ActionType>().notNull(),
  // Action-specific config (e.g., {folderId: 3} for move_to_folder)
  actionConfig: text('action_config', { mode: 'json' }).$type<ActionConfig>(),
  // Which folders this rule applies to (for preview/apply, not live import)
  folderIds: text('folder_ids', { mode: 'json' }).notNull().default('[1]').$type<number[]>(),
  // Order for "first match wins" evaluation
  position: integer('position').notNull().default(0),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

export const ruleApplications = sqliteTable('rule_applications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Null ruleId indicates "apply all rules" job
  ruleId: integer('rule_id').references(() => emailRules.id),
  // Job status
  status: text('status').$type<'pending' | 'running' | 'completed' | 'failed'>().notNull().default('pending'),
  totalCount: integer('total_count').notNull().default(0),
  processedCount: integer('processed_count').notNull().default(0),
  matchedCount: integer('matched_count').notNull().default(0),
  // Breakdown of matches per rule (for "apply all" jobs): { [ruleId]: count }
  matchBreakdown: text('match_breakdown', { mode: 'json' }).$type<Record<number, number>>(),
  error: text('error'),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

// --- Types ---

export type MatchType = 'exact' | 'contains' | 'regex'

/**
 * Known field types for rule conditions.
 * Also supports:
 * - 'sender_in_contacts': value is JSON array of email addresses
 * - 'header:X-Header-Name': matches against specific email header value
 */
export type FieldType =
  | 'thread_subject'
  | 'email_subject'
  | 'sender_name'
  | 'sender_email'
  | 'to_name'
  | 'to_email'
  | 'cc_name'
  | 'cc_email'
  | 'content'
  | 'attachment_filename'
  | 'sender_in_contacts'

export interface Condition {
  /** Field to match - either a FieldType or 'header:HeaderName' pattern */
  field: FieldType | `header:${string}`
  matchType: MatchType
  value: string
  negate?: boolean
}

export interface ConditionGroup {
  operator: 'AND' | 'OR'
  conditions: (Condition | ConditionGroup)[]
}

export type ActionType =
  | 'delete_thread'
  | 'move_to_folder'
  | 'mark_read'
  | 'add_to_reply_later'
  | 'add_to_set_aside'

export interface ActionConfig {
  folderId?: number
}
