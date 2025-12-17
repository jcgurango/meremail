import { eq, and, isNull } from 'drizzle-orm'
import { db } from '../db'
import { emailRules, emailThreads, emails, contacts, emailContacts, attachments } from '../db/schema'
import type { Condition, ConditionGroup, ActionType, ActionConfig, FieldType, MatchType } from '../db/schema/rules'
import type { ImportableEmail } from '../types/email'

// Folder IDs
const TRASH_FOLDER_ID = 3

/**
 * Context for evaluating rules during email import
 */
export interface RuleEvaluationContext {
  // Email content
  emailSubject: string
  threadSubject: string
  content: string

  // Sender
  senderEmail: string
  senderName: string

  // Recipients
  toEmails: string[]
  toNames: string[]
  ccEmails: string[]
  ccNames: string[]

  // Attachments
  attachmentFilenames: string[]

  // Headers (key-value pairs for header matching)
  headers: { key: string; value: string }[]
}

/**
 * Result of rule evaluation
 */
export interface RuleEvaluationResult {
  ruleId: number
  ruleName: string
  actionType: ActionType
  actionConfig: ActionConfig | null
}

/**
 * Result of applying a rule action
 */
export interface RuleActionResult {
  /** Override folder assignment */
  folderId?: number
  /** Mark email as read */
  markRead?: boolean
  /** Skip importing the email entirely (delete action) */
  skipImport?: boolean
  /** Add to Reply Later queue */
  addToReplyLater?: boolean
  /** Add to Set Aside queue */
  addToSetAside?: boolean
}

/**
 * Build evaluation context from an importable email
 */
export function buildRuleContext(
  email: ImportableEmail,
  threadSubject: string
): RuleEvaluationContext {
  return {
    emailSubject: email.subject,
    threadSubject,
    content: email.textContent || '',
    senderEmail: email.from?.email || '',
    senderName: email.from?.name || '',
    toEmails: email.to.map(r => r.email),
    toNames: email.to.map(r => r.name || ''),
    ccEmails: email.cc.map(r => r.email),
    ccNames: email.cc.map(r => r.name || ''),
    attachmentFilenames: email.attachments.map(a => a.filename || ''),
    headers: email.headers,
  }
}

/**
 * Get field value(s) from context for matching
 * Returns an array since some fields can have multiple values (recipients, attachments)
 */
function getFieldValues(field: FieldType, ctx: RuleEvaluationContext): string[] {
  switch (field) {
    case 'thread_subject':
      return [ctx.threadSubject]
    case 'email_subject':
      return [ctx.emailSubject]
    case 'sender_name':
      return [ctx.senderName]
    case 'sender_email':
      return [ctx.senderEmail]
    case 'to_name':
      return ctx.toNames
    case 'to_email':
      return ctx.toEmails
    case 'cc_name':
      return ctx.ccNames
    case 'cc_email':
      return ctx.ccEmails
    case 'content':
      return [ctx.content]
    case 'attachment_filename':
      return ctx.attachmentFilenames
    default:
      return []
  }
}

/**
 * Match a single value against a pattern using the specified match type
 */
function matchValue(value: string, pattern: string, matchType: MatchType): boolean {
  if (!value && matchType !== 'exact') return false

  switch (matchType) {
    case 'exact':
      return value.toLowerCase() === pattern.toLowerCase()
    case 'contains':
      return value.toLowerCase().includes(pattern.toLowerCase())
    case 'regex':
      try {
        const regex = new RegExp(pattern, 'i')
        return regex.test(value)
      } catch {
        // Invalid regex - treat as no match
        return false
      }
    default:
      return false
  }
}

/**
 * Evaluate a single condition against the context
 */
function evaluateCondition(condition: Condition, ctx: RuleEvaluationContext): boolean {
  const field = condition.field

  // Handle special condition types
  if (field === 'sender_in_contacts') {
    // Value is a JSON array of email addresses
    try {
      const emailList = JSON.parse(condition.value) as string[]
      const senderLower = ctx.senderEmail.toLowerCase()
      const result = emailList.some(email => email.toLowerCase() === senderLower)
      return condition.negate ? !result : result
    } catch {
      // Invalid JSON - no match
      return condition.negate ? true : false
    }
  }

  if (field.startsWith('header:')) {
    // Extract header name from field (e.g., "header:X-Spam-Score" -> "X-Spam-Score")
    const headerName = field.slice(7).toLowerCase()
    // Find matching header (case-insensitive key match)
    const headerValues = ctx.headers
      .filter(h => h.key.toLowerCase() === headerName)
      .map(h => {
        // Extract value portion after "Header-Name: "
        const colonIndex = h.value.indexOf(':')
        return colonIndex >= 0 ? h.value.slice(colonIndex + 1).trim() : h.value
      })

    if (headerValues.length === 0) {
      return condition.negate ? true : false
    }

    const result = headerValues.some(value =>
      matchValue(value, condition.value, condition.matchType)
    )
    return condition.negate ? !result : result
  }

  // Standard field types
  const values = getFieldValues(field as FieldType, ctx)

  // For multi-value fields (recipients, attachments), any match counts
  const result = values.some(value =>
    matchValue(value, condition.value, condition.matchType)
  )

  return condition.negate ? !result : result
}

/**
 * Check if an item is a condition group (has operator) or a leaf condition
 */
function isConditionGroup(item: Condition | ConditionGroup): item is ConditionGroup {
  return 'operator' in item
}

/**
 * Recursively evaluate a condition group
 */
function evaluateGroup(group: ConditionGroup, ctx: RuleEvaluationContext): boolean {
  if (group.conditions.length === 0) {
    // Empty group matches nothing
    return false
  }

  if (group.operator === 'AND') {
    return group.conditions.every(item =>
      isConditionGroup(item) ? evaluateGroup(item, ctx) : evaluateCondition(item, ctx)
    )
  } else {
    return group.conditions.some(item =>
      isConditionGroup(item) ? evaluateGroup(item, ctx) : evaluateCondition(item, ctx)
    )
  }
}

/**
 * Evaluate a condition group directly against a context
 * Used for rule preview without saving the rule first
 */
export function evaluateConditions(conditions: ConditionGroup, ctx: RuleEvaluationContext): boolean {
  return evaluateGroup(conditions, ctx)
}

/**
 * Evaluate all enabled rules against the context
 * Returns the first matching rule (first match wins based on position)
 *
 * @param ctx - The rule evaluation context
 * @param targetFolderId - Optional folder ID to filter rules by their folderIds setting.
 *                         If provided, only rules that include this folder in their folderIds
 *                         will be evaluated. This is used during import to respect the rule's
 *                         "apply to folders" setting.
 */
export function evaluateRules(ctx: RuleEvaluationContext, targetFolderId?: number): RuleEvaluationResult | null {
  const rules = db
    .select()
    .from(emailRules)
    .where(eq(emailRules.enabled, true))
    .orderBy(emailRules.position)
    .all()

  for (const rule of rules) {
    // If targetFolderId is provided, skip rules that don't apply to this folder
    if (targetFolderId !== undefined) {
      const ruleFolderIds = rule.folderIds as number[]
      if (!ruleFolderIds.includes(targetFolderId)) {
        continue
      }
    }

    const conditions = rule.conditions as ConditionGroup
    if (evaluateGroup(conditions, ctx)) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        actionType: rule.actionType as ActionType,
        actionConfig: rule.actionConfig as ActionConfig | null,
      }
    }
  }

  return null
}

/**
 * Determine what actions to take based on a rule result
 * Called during import to determine folder assignment, read status, etc.
 */
export function determineImportActions(result: RuleEvaluationResult): RuleActionResult {
  const actions: RuleActionResult = {}

  switch (result.actionType) {
    case 'delete_thread':
    case 'delete_email':
      // Move to Trash folder
      actions.folderId = TRASH_FOLDER_ID
      actions.markRead = true // Auto-mark trashed items as read
      break

    case 'move_to_folder':
      if (result.actionConfig?.folderId) {
        actions.folderId = result.actionConfig.folderId
      }
      break

    case 'mark_read':
      actions.markRead = true
      break

    case 'add_to_reply_later':
      actions.addToReplyLater = true
      break

    case 'add_to_set_aside':
      actions.addToSetAside = true
      break
  }

  return actions
}

/**
 * Apply a rule action to an existing thread (for retroactive application)
 */
export async function applyRuleToThread(
  threadId: number,
  result: RuleEvaluationResult
): Promise<void> {
  const now = new Date()

  switch (result.actionType) {
    case 'delete_thread':
      // Get current folder for restore
      const thread = db.select({ folderId: emailThreads.folderId })
        .from(emailThreads)
        .where(eq(emailThreads.id, threadId))
        .get()

      if (thread) {
        db.update(emailThreads)
          .set({
            previousFolderId: thread.folderId,
            folderId: TRASH_FOLDER_ID,
            trashedAt: now,
            updatedAt: now,
          })
          .where(eq(emailThreads.id, threadId))
          .run()
      }
      break

    case 'delete_email':
      // For delete_email on retroactive, we trash the whole thread
      // (individual email deletion doesn't make sense retroactively)
      const threadForDelete = db.select({ folderId: emailThreads.folderId })
        .from(emailThreads)
        .where(eq(emailThreads.id, threadId))
        .get()

      if (threadForDelete) {
        db.update(emailThreads)
          .set({
            previousFolderId: threadForDelete.folderId,
            folderId: TRASH_FOLDER_ID,
            trashedAt: now,
            updatedAt: now,
          })
          .where(eq(emailThreads.id, threadId))
          .run()
      }
      break

    case 'move_to_folder':
      if (result.actionConfig?.folderId) {
        db.update(emailThreads)
          .set({
            folderId: result.actionConfig.folderId,
            updatedAt: now,
          })
          .where(eq(emailThreads.id, threadId))
          .run()
      }
      break

    case 'mark_read':
      db.update(emails)
        .set({ readAt: now })
        .where(and(
          eq(emails.threadId, threadId),
          isNull(emails.readAt)
        ))
        .run()
      break

    case 'add_to_reply_later':
      db.update(emailThreads)
        .set({
          replyLaterAt: now,
          updatedAt: now,
        })
        .where(eq(emailThreads.id, threadId))
        .run()
      break

    case 'add_to_set_aside':
      db.update(emailThreads)
        .set({
          setAsideAt: now,
          updatedAt: now,
        })
        .where(eq(emailThreads.id, threadId))
        .run()
      break
  }
}

/**
 * Build context from an existing thread for retroactive rule evaluation
 */
export function buildContextFromThread(threadId: number): RuleEvaluationContext | null {
  // Get thread with its first email
  const threadData = db
    .select({
      threadSubject: emailThreads.subject,
      emailSubject: emails.subject,
      content: emails.contentText,
      senderId: emails.senderId,
      headers: emails.headers,
    })
    .from(emailThreads)
    .innerJoin(emails, eq(emails.threadId, emailThreads.id))
    .where(eq(emailThreads.id, threadId))
    .orderBy(emails.sentAt)
    .limit(1)
    .get()

  if (!threadData) return null

  // Get sender info
  const sender = db
    .select({ email: contacts.email, name: contacts.name })
    .from(contacts)
    .where(eq(contacts.id, threadData.senderId))
    .get()

  // Get recipients from first email
  const firstEmail = db
    .select({ id: emails.id })
    .from(emails)
    .where(eq(emails.threadId, threadId))
    .orderBy(emails.sentAt)
    .limit(1)
    .get()

  const recipients = firstEmail ? db
    .select({
      role: emailContacts.role,
      email: contacts.email,
      name: contacts.name,
    })
    .from(emailContacts)
    .innerJoin(contacts, eq(emailContacts.contactId, contacts.id))
    .where(eq(emailContacts.emailId, firstEmail.id))
    .all() : []

  // Get attachments from first email
  const emailAttachments = firstEmail ? db
    .select({ filename: attachments.filename })
    .from(attachments)
    .where(eq(attachments.emailId, firstEmail.id))
    .all() : []

  return {
    emailSubject: threadData.emailSubject,
    threadSubject: threadData.threadSubject,
    content: threadData.content || '',
    senderEmail: sender?.email || '',
    senderName: sender?.name || '',
    toEmails: recipients.filter(r => r.role === 'to').map(r => r.email),
    toNames: recipients.filter(r => r.role === 'to').map(r => r.name || ''),
    ccEmails: recipients.filter(r => r.role === 'cc').map(r => r.email),
    ccNames: recipients.filter(r => r.role === 'cc').map(r => r.name || ''),
    attachmentFilenames: emailAttachments.map(a => a.filename || ''),
    headers: threadData.headers || [],
  }
}
