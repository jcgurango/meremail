import { sql } from 'drizzle-orm'
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

  // Mark emails as read
  db.update(emails)
    .set({ isRead: true })
    .where(sql`${emails.id} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`)
    .run()

  return { success: true, count: ids.length }
})
