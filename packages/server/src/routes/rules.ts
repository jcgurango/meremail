import { Hono } from 'hono'
import { eq, sql, asc, desc, isNull, inArray } from 'drizzle-orm'
import {
  db,
  emailRules,
  ruleApplications,
  emailThreads,
  emails,
  contacts,
  emailContacts,
  attachments,
  evaluateRules,
  evaluateConditions,
  applyRuleToThread,
  buildContextFromThread,
} from '@meremail/shared'
import type { ConditionGroup, Condition, ActionType, ActionConfig, RuleEvaluationContext } from '@meremail/shared'

export const rulesRoutes = new Hono()

// GET /api/rules - List all rules
rulesRoutes.get('/', async (c) => {
  const rules = db
    .select()
    .from(emailRules)
    .orderBy(asc(emailRules.position))
    .all()

  return c.json({
    rules: rules.map(rule => ({
      id: rule.id,
      name: rule.name,
      conditions: rule.conditions,
      actionType: rule.actionType,
      actionConfig: rule.actionConfig,
      folderIds: rule.folderIds,
      position: rule.position,
      enabled: rule.enabled,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    })),
  })
})

// POST /api/rules - Create new rule
rulesRoutes.post('/', async (c) => {
  const body = await c.req.json()

  // Validate required fields
  if (!body.name || typeof body.name !== 'string') {
    return c.json({ error: 'name is required' }, 400)
  }
  if (!body.conditions) {
    return c.json({ error: 'conditions is required' }, 400)
  }
  if (!body.actionType || typeof body.actionType !== 'string') {
    return c.json({ error: 'actionType is required' }, 400)
  }

  // Get max position for new rule
  const maxPosition = db
    .select({ max: sql<number>`MAX(${emailRules.position})` })
    .from(emailRules)
    .get()?.max || 0

  const now = new Date()

  // Validate folderIds if provided
  const folderIds = Array.isArray(body.folderIds) ? body.folderIds : [1]

  const result = db
    .insert(emailRules)
    .values({
      name: body.name,
      conditions: body.conditions as ConditionGroup,
      actionType: body.actionType as ActionType,
      actionConfig: body.actionConfig as ActionConfig || null,
      folderIds,
      position: maxPosition + 1,
      enabled: body.enabled !== false,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()

  return c.json({
    rule: {
      id: result.id,
      name: result.name,
      conditions: result.conditions,
      actionType: result.actionType,
      actionConfig: result.actionConfig,
      folderIds: result.folderIds,
      position: result.position,
      enabled: result.enabled,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    },
  }, 201)
})

// GET /api/rules/applications - List all applications
// NOTE: This must be defined BEFORE /:id to avoid "applications" being parsed as an ID
rulesRoutes.get('/applications', async (c) => {
  const applications = db
    .select({
      id: ruleApplications.id,
      ruleId: ruleApplications.ruleId,
      ruleName: emailRules.name,
      status: ruleApplications.status,
      totalCount: ruleApplications.totalCount,
      processedCount: ruleApplications.processedCount,
      matchedCount: ruleApplications.matchedCount,
      matchBreakdown: ruleApplications.matchBreakdown,
      error: ruleApplications.error,
      startedAt: ruleApplications.startedAt,
      completedAt: ruleApplications.completedAt,
      createdAt: ruleApplications.createdAt,
    })
    .from(ruleApplications)
    .leftJoin(emailRules, eq(ruleApplications.ruleId, emailRules.id))
    .orderBy(desc(ruleApplications.createdAt))
    .limit(50)
    .all()

  // For "apply all" jobs (null ruleId), set a descriptive name
  return c.json({
    applications: applications.map(app => ({
      ...app,
      ruleName: app.ruleId === null ? 'All Rules' : app.ruleName,
    })),
  })
})

// GET /api/rules/applications/:id - Get application status
rulesRoutes.get('/applications/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid application ID' }, 400)
  }

  const application = db
    .select({
      id: ruleApplications.id,
      ruleId: ruleApplications.ruleId,
      ruleName: emailRules.name,
      status: ruleApplications.status,
      totalCount: ruleApplications.totalCount,
      processedCount: ruleApplications.processedCount,
      matchedCount: ruleApplications.matchedCount,
      matchBreakdown: ruleApplications.matchBreakdown,
      error: ruleApplications.error,
      startedAt: ruleApplications.startedAt,
      completedAt: ruleApplications.completedAt,
      createdAt: ruleApplications.createdAt,
    })
    .from(ruleApplications)
    .leftJoin(emailRules, eq(ruleApplications.ruleId, emailRules.id))
    .where(eq(ruleApplications.id, id))
    .get()

  if (!application) {
    return c.json({ error: 'Application not found' }, 404)
  }

  return c.json({
    application: {
      ...application,
      ruleName: application.ruleId === null ? 'All Rules' : application.ruleName,
    },
  })
})

// GET /api/rules/:id - Get single rule
rulesRoutes.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid rule ID' }, 400)
  }

  const rule = db
    .select()
    .from(emailRules)
    .where(eq(emailRules.id, id))
    .get()

  if (!rule) {
    return c.json({ error: 'Rule not found' }, 404)
  }

  return c.json({
    rule: {
      id: rule.id,
      name: rule.name,
      conditions: rule.conditions,
      actionType: rule.actionType,
      actionConfig: rule.actionConfig,
      folderIds: rule.folderIds,
      position: rule.position,
      enabled: rule.enabled,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    },
  })
})

// PATCH /api/rules/:id - Update rule
rulesRoutes.patch('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid rule ID' }, 400)
  }

  const existingRule = db
    .select()
    .from(emailRules)
    .where(eq(emailRules.id, id))
    .get()

  if (!existingRule) {
    return c.json({ error: 'Rule not found' }, 404)
  }

  const body = await c.req.json()
  const updates: Partial<typeof emailRules.$inferInsert> = {
    updatedAt: new Date(),
  }

  if (body.name !== undefined) updates.name = body.name
  if (body.conditions !== undefined) updates.conditions = body.conditions
  if (body.actionType !== undefined) updates.actionType = body.actionType
  if (body.actionConfig !== undefined) updates.actionConfig = body.actionConfig
  if (body.folderIds !== undefined) updates.folderIds = body.folderIds
  if (body.enabled !== undefined) updates.enabled = body.enabled

  db.update(emailRules)
    .set(updates)
    .where(eq(emailRules.id, id))
    .run()

  const updatedRule = db
    .select()
    .from(emailRules)
    .where(eq(emailRules.id, id))
    .get()

  return c.json({
    rule: updatedRule ? {
      id: updatedRule.id,
      name: updatedRule.name,
      conditions: updatedRule.conditions,
      actionType: updatedRule.actionType,
      actionConfig: updatedRule.actionConfig,
      folderIds: updatedRule.folderIds,
      position: updatedRule.position,
      enabled: updatedRule.enabled,
      createdAt: updatedRule.createdAt,
      updatedAt: updatedRule.updatedAt,
    } : null,
  })
})

// DELETE /api/rules/:id - Delete rule
rulesRoutes.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid rule ID' }, 400)
  }

  const existingRule = db
    .select()
    .from(emailRules)
    .where(eq(emailRules.id, id))
    .get()

  if (!existingRule) {
    return c.json({ error: 'Rule not found' }, 404)
  }

  // Delete any pending/running applications
  db.delete(ruleApplications)
    .where(eq(ruleApplications.ruleId, id))
    .run()

  db.delete(emailRules)
    .where(eq(emailRules.id, id))
    .run()

  return c.json({ success: true })
})

// POST /api/rules/reorder - Reorder rules
rulesRoutes.post('/reorder', async (c) => {
  const body = await c.req.json()

  if (!Array.isArray(body.positions)) {
    return c.json({ error: 'positions array is required' }, 400)
  }

  // positions should be an array of { id: number, position: number }
  for (const item of body.positions) {
    if (typeof item.id !== 'number' || typeof item.position !== 'number') {
      return c.json({ error: 'Each position must have id and position as numbers' }, 400)
    }

    db.update(emailRules)
      .set({ position: item.position, updatedAt: new Date() })
      .where(eq(emailRules.id, item.id))
      .run()
  }

  return c.json({ success: true })
})

// POST /api/rules/preview - Preview rule matches without saving
rulesRoutes.post('/preview', async (c) => {
  const body = await c.req.json()

  if (!body.conditions) {
    return c.json({ error: 'conditions is required' }, 400)
  }

  const conditions = body.conditions as ConditionGroup
  const folderIds: number[] = Array.isArray(body.folderIds) ? body.folderIds : [1]
  const MAX_SCAN = 1000
  const MAX_MATCHES = 20

  const matches: Array<{
    id: number
    threadId: number | null
    subject: string
    senderName: string | null
    senderEmail: string
    sentAt: string | null
  }> = []

  let scannedCount = 0
  let offset = 0
  const BATCH_SIZE = 100

  while (scannedCount < MAX_SCAN && matches.length < MAX_MATCHES) {
    // Get batch of emails from threads in selected folders
    const emailBatch = db
      .select({
        id: emails.id,
        threadId: emails.threadId,
        subject: emails.subject,
        senderId: emails.senderId,
        contentText: emails.contentText,
        headers: emails.headers,
        sentAt: emails.sentAt,
      })
      .from(emails)
      .innerJoin(emailThreads, eq(emails.threadId, emailThreads.id))
      .where(sql`${emails.trashedAt} IS NULL AND ${emailThreads.folderId} IN (${sql.join(folderIds.map(id => sql`${id}`), sql`, `)})`)
      .orderBy(desc(emails.sentAt))
      .limit(BATCH_SIZE)
      .offset(offset)
      .all()

    if (emailBatch.length === 0) break

    for (const email of emailBatch) {
      if (scannedCount >= MAX_SCAN || matches.length >= MAX_MATCHES) break
      scannedCount++

      // Get sender info
      const sender = db
        .select({ email: contacts.email, name: contacts.name })
        .from(contacts)
        .where(eq(contacts.id, email.senderId))
        .get()

      // Get recipients
      const recipients = db
        .select({
          role: emailContacts.role,
          email: contacts.email,
          name: contacts.name,
        })
        .from(emailContacts)
        .innerJoin(contacts, eq(emailContacts.contactId, contacts.id))
        .where(eq(emailContacts.emailId, email.id))
        .all()

      // Get attachments
      const emailAttachments = db
        .select({ filename: attachments.filename })
        .from(attachments)
        .where(eq(attachments.emailId, email.id))
        .all()

      // Get thread subject if available
      let threadSubject = email.subject
      if (email.threadId) {
        const thread = db
          .select({ subject: emailThreads.subject })
          .from(emailThreads)
          .where(eq(emailThreads.id, email.threadId))
          .get()
        if (thread) threadSubject = thread.subject
      }

      // Build context
      const ctx: RuleEvaluationContext = {
        emailSubject: email.subject,
        threadSubject,
        content: email.contentText || '',
        senderEmail: sender?.email || '',
        senderName: sender?.name || '',
        toEmails: recipients.filter(r => r.role === 'to').map(r => r.email),
        toNames: recipients.filter(r => r.role === 'to').map(r => r.name || ''),
        ccEmails: recipients.filter(r => r.role === 'cc').map(r => r.email),
        ccNames: recipients.filter(r => r.role === 'cc').map(r => r.name || ''),
        attachmentFilenames: emailAttachments.map(a => a.filename || ''),
        headers: email.headers || [],
      }

      // Evaluate conditions
      if (evaluateConditions(conditions, ctx)) {
        matches.push({
          id: email.id,
          threadId: email.threadId,
          subject: email.subject,
          senderName: sender?.name || null,
          senderEmail: sender?.email || '',
          sentAt: email.sentAt?.toISOString() || null,
        })
      }
    }

    offset += emailBatch.length
  }

  return c.json({
    matches,
    scannedCount,
    matchCount: matches.length,
  })
})

// POST /api/rules/:id/apply - Start retroactive rule application
rulesRoutes.post('/:id/apply', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid rule ID' }, 400)
  }

  const rule = db
    .select()
    .from(emailRules)
    .where(eq(emailRules.id, id))
    .get()

  if (!rule) {
    return c.json({ error: 'Rule not found' }, 404)
  }

  // Use the rule's configured folder IDs
  const folderIds = rule.folderIds

  // Count total threads to process in selected folders
  const totalCount = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emailThreads)
    .where(inArray(emailThreads.folderId, folderIds))
    .get()?.count || 0

  const now = new Date()

  // Create application record
  const application = db
    .insert(ruleApplications)
    .values({
      ruleId: id,
      status: 'running',
      totalCount,
      processedCount: 0,
      matchedCount: 0,
      startedAt: now,
      createdAt: now,
    })
    .returning()
    .get()

  // Process in background
  processRuleApplication(application.id, rule, folderIds).catch(err => {
    console.error(`Rule application ${application.id} failed:`, err)
    db.update(ruleApplications)
      .set({
        status: 'failed',
        error: err.message || 'Unknown error',
        completedAt: new Date(),
      })
      .where(eq(ruleApplications.id, application.id))
      .run()
  })

  return c.json({ application: { id: application.id, status: 'running', totalCount } })
})

// Helper to yield event loop and allow other requests to process
function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

// Background processing function
async function processRuleApplication(
  applicationId: number,
  rule: typeof emailRules.$inferSelect,
  folderIds: number[]
): Promise<void> {
  const BATCH_SIZE = 50  // Smaller batches for better responsiveness
  let offset = 0
  let matchedCount = 0

  const ruleResult = {
    ruleId: rule.id,
    ruleName: rule.name,
    actionType: rule.actionType as ActionType,
    actionConfig: rule.actionConfig as ActionConfig | null,
  }

  while (true) {
    // Yield to event loop before each batch to allow other requests
    await yieldToEventLoop()

    // Get batch of threads from selected folders
    const threads = db
      .select({ id: emailThreads.id })
      .from(emailThreads)
      .where(inArray(emailThreads.folderId, folderIds))
      .limit(BATCH_SIZE)
      .offset(offset)
      .all()

    if (threads.length === 0) break

    for (const thread of threads) {
      // Build context from thread
      const context = buildContextFromThread(thread.id)
      if (!context) continue

      // Evaluate THIS rule's conditions directly (not all rules)
      // This ensures the specific rule being applied is tested, regardless of priority
      const conditions = rule.conditions as ConditionGroup
      if (evaluateConditions(conditions, context)) {
        await applyRuleToThread(thread.id, ruleResult)
        matchedCount++
      }
    }

    offset += threads.length

    // Update progress
    db.update(ruleApplications)
      .set({
        processedCount: offset,
        matchedCount,
      })
      .where(eq(ruleApplications.id, applicationId))
      .run()

    // Yield again after updating progress
    await yieldToEventLoop()
  }

  // Mark as completed
  db.update(ruleApplications)
    .set({
      status: 'completed',
      processedCount: offset,
      matchedCount,
      completedAt: new Date(),
    })
    .where(eq(ruleApplications.id, applicationId))
    .run()
}

// POST /api/rules/apply-all - Run all rules against all threads
rulesRoutes.post('/apply-all', async (c) => {
  const body = await c.req.json().catch(() => ({}))

  // Optional folder IDs filter (default: all folders)
  const folderIds: number[] = Array.isArray(body.folderIds) ? body.folderIds : []

  // Count total threads to process
  const whereClause = folderIds.length > 0
    ? inArray(emailThreads.folderId, folderIds)
    : undefined

  const totalCount = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emailThreads)
    .where(whereClause)
    .get()?.count || 0

  const now = new Date()

  // Create application record with null ruleId (indicates "apply all")
  const application = db
    .insert(ruleApplications)
    .values({
      ruleId: null,
      status: 'running',
      totalCount,
      processedCount: 0,
      matchedCount: 0,
      matchBreakdown: {},
      startedAt: now,
      createdAt: now,
    })
    .returning()
    .get()

  // Process in background
  processAllRulesApplication(application.id, folderIds.length > 0 ? folderIds : undefined).catch(err => {
    console.error(`Apply all rules job ${application.id} failed:`, err)
    db.update(ruleApplications)
      .set({
        status: 'failed',
        error: err.message || 'Unknown error',
        completedAt: new Date(),
      })
      .where(eq(ruleApplications.id, application.id))
      .run()
  })

  return c.json({ application: { id: application.id, status: 'running', totalCount } })
})

// Background processing for apply-all
async function processAllRulesApplication(
  applicationId: number,
  folderIds?: number[]
): Promise<void> {
  const BATCH_SIZE = 50
  let offset = 0
  let matchedCount = 0
  const matchBreakdown: Record<number, number> = {}

  while (true) {
    await yieldToEventLoop()

    // Get batch of threads
    const whereClause = folderIds
      ? inArray(emailThreads.folderId, folderIds)
      : undefined

    const threads = db
      .select({ id: emailThreads.id, folderId: emailThreads.folderId })
      .from(emailThreads)
      .where(whereClause)
      .limit(BATCH_SIZE)
      .offset(offset)
      .all()

    if (threads.length === 0) break

    for (const thread of threads) {
      // Build context from thread
      const context = buildContextFromThread(thread.id)
      if (!context) continue

      // Evaluate all rules (pass folderId so rules respect their folder settings)
      const result = evaluateRules(context, thread.folderId ?? undefined)

      if (result) {
        // Apply the matching rule
        await applyRuleToThread(thread.id, result)
        matchedCount++

        // Track per-rule breakdown
        matchBreakdown[result.ruleId] = (matchBreakdown[result.ruleId] || 0) + 1
      }
    }

    offset += threads.length

    // Update progress
    db.update(ruleApplications)
      .set({
        processedCount: offset,
        matchedCount,
        matchBreakdown,
      })
      .where(eq(ruleApplications.id, applicationId))
      .run()

    await yieldToEventLoop()
  }

  // Mark as completed
  db.update(ruleApplications)
    .set({
      status: 'completed',
      processedCount: offset,
      matchedCount,
      matchBreakdown,
      completedAt: new Date(),
    })
    .where(eq(ruleApplications.id, applicationId))
    .run()
}

// POST /api/rules/:id/add-sender - Add a sender email to a rule's sender_in_contacts condition
rulesRoutes.post('/:id/add-sender', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid rule ID' }, 400)
  }

  const body = await c.req.json()
  const senderEmail = body.email?.toLowerCase()?.trim()

  if (!senderEmail) {
    return c.json({ error: 'email is required' }, 400)
  }

  const rule = db
    .select()
    .from(emailRules)
    .where(eq(emailRules.id, id))
    .get()

  if (!rule) {
    return c.json({ error: 'Rule not found' }, 404)
  }

  const conditions = rule.conditions as ConditionGroup

  // Find a top-level sender_in_contacts condition
  let foundCondition: Condition | null = null
  let conditionIndex = -1

  for (let i = 0; i < conditions.conditions.length; i++) {
    const cond = conditions.conditions[i]
    // Check if it's a leaf condition (not a group) with sender_in_contacts field
    if (cond && !('operator' in cond) && cond.field === 'sender_in_contacts') {
      foundCondition = cond as Condition
      conditionIndex = i
      break
    }
  }

  if (!foundCondition) {
    return c.json({ error: 'This rule does not have a top-level "Sender In List" condition' }, 400)
  }

  // Parse the existing email list
  let emailList: string[]
  try {
    emailList = JSON.parse(foundCondition.value) as string[]
  } catch {
    emailList = []
  }

  // Check if email is already in the list
  if (emailList.some(e => e.toLowerCase() === senderEmail)) {
    return c.json({ error: 'Sender is already in this rule' }, 400)
  }

  // Add the email to the list
  emailList.push(senderEmail)

  // Update the condition
  const updatedCondition: Condition = {
    field: foundCondition.field,
    matchType: foundCondition.matchType,
    value: JSON.stringify(emailList),
    negate: foundCondition.negate,
  }

  const updatedConditions: ConditionGroup = {
    operator: conditions.operator,
    conditions: conditions.conditions.map((c, i) =>
      i === conditionIndex ? updatedCondition : c
    ),
  }

  // Save the updated rule
  db.update(emailRules)
    .set({
      conditions: updatedConditions,
      updatedAt: new Date(),
    })
    .where(eq(emailRules.id, id))
    .run()

  return c.json({ success: true, emailCount: emailList.length })
})
