import { sql, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { emails } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const ids = body?.ids as number[]

  if (!Array.isArray(ids) || ids.length === 0) {
    throw createError({ statusCode: 400, message: 'ids must be a non-empty array' })
  }

  // Validate all IDs are numbers
  if (!ids.every(id => typeof id === 'number' && !isNaN(id))) {
    throw createError({ statusCode: 400, message: 'All ids must be valid numbers' })
  }

  // Mark emails as read (only if not already read)
  const now = new Date()
  db.update(emails)
    .set({ readAt: now })
    .where(sql`${emails.id} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)}) AND ${isNull(emails.readAt)}`)
    .run()

  return { success: true, count: ids.length }
})
