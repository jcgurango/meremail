import { eq } from 'drizzle-orm'
import { db } from '../../../db'
import { emailThreads } from '../../../db/schema'

export default defineEventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '')
  if (isNaN(id)) {
    throw createError({ statusCode: 400, message: 'Invalid thread ID' })
  }

  const body = await readBody(event)
  const setAside = body?.setAside

  if (typeof setAside !== 'boolean') {
    throw createError({ statusCode: 400, message: 'setAside must be a boolean' })
  }

  // Update the thread - set timestamp when adding, null when removing
  const setAsideAt = setAside ? new Date() : null

  db.update(emailThreads)
    .set({ setAsideAt })
    .where(eq(emailThreads.id, id))
    .run()

  return { success: true, setAside, setAsideAt }
})
