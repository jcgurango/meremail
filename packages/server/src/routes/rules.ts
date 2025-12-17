import { Hono } from 'hono'
import { eq, sql, asc } from 'drizzle-orm'
import {
  db,
  emailRules,
  ruleApplications,
  emailThreads,
  evaluateRules,
  applyRuleToThread,
  buildContextFromThread,
} from '@meremail/shared'
import type { ConditionGroup, ActionType, ActionConfig } from '@meremail/shared'

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

  const result = db
    .insert(emailRules)
    .values({
      name: body.name,
      conditions: body.conditions as ConditionGroup,
      actionType: body.actionType as ActionType,
      actionConfig: body.actionConfig as ActionConfig || null,
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
      position: result.position,
      enabled: result.enabled,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    },
  }, 201)
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

  // Count total threads to process
  const totalCount = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emailThreads)
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
  processRuleApplication(application.id, rule).catch(err => {
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

// GET /api/rule-applications/:id - Get application status
rulesRoutes.get('/applications/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid application ID' }, 400)
  }

  const application = db
    .select()
    .from(ruleApplications)
    .where(eq(ruleApplications.id, id))
    .get()

  if (!application) {
    return c.json({ error: 'Application not found' }, 404)
  }

  return c.json({ application })
})

// Background processing function
async function processRuleApplication(
  applicationId: number,
  rule: typeof emailRules.$inferSelect
): Promise<void> {
  const BATCH_SIZE = 100
  let offset = 0
  let matchedCount = 0

  const ruleResult = {
    ruleId: rule.id,
    ruleName: rule.name,
    actionType: rule.actionType as ActionType,
    actionConfig: rule.actionConfig as ActionConfig | null,
  }

  while (true) {
    // Get batch of threads
    const threads = db
      .select({ id: emailThreads.id })
      .from(emailThreads)
      .limit(BATCH_SIZE)
      .offset(offset)
      .all()

    if (threads.length === 0) break

    for (const thread of threads) {
      // Build context from thread
      const context = buildContextFromThread(thread.id)
      if (!context) continue

      // Evaluate rule against this thread
      const result = evaluateRules(context)

      // Only apply if THIS rule matches (since we're applying a specific rule)
      if (result && result.ruleId === rule.id) {
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
