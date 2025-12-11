import { eq } from 'drizzle-orm'
import { db } from '../../../db'
import { emailThreads } from '../../../db/schema'

export default defineEventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '')
  if (isNaN(id)) {
    throw createError({ statusCode: 400, message: 'Invalid thread ID' })
  }

  const body = await readBody(event)
  const replyLater = body?.replyLater

  if (typeof replyLater !== 'boolean') {
    throw createError({ statusCode: 400, message: 'replyLater must be a boolean' })
  }

  // Update the thread
  db.update(emailThreads)
    .set({ replyLater })
    .where(eq(emailThreads.id, id))
    .run()

  return { success: true, replyLater }
})
