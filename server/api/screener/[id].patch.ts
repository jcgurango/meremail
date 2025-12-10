import { db } from '../../db'
import { contacts } from '../../db/schema'
import { eq } from 'drizzle-orm'

const VALID_BUCKETS = ['approved', 'feed', 'paper_trail', 'blocked'] as const

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: 'Invalid contact ID' })
  }

  const body = await readBody(event)
  const bucket = body?.bucket

  if (!bucket || !VALID_BUCKETS.includes(bucket)) {
    throw createError({
      statusCode: 400,
      message: `Invalid bucket. Must be one of: ${VALID_BUCKETS.join(', ')}`,
    })
  }

  await db
    .update(contacts)
    .set({ bucket })
    .where(eq(contacts.id, id))

  return { success: true, bucket }
})
