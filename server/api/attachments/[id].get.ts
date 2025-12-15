import { eq } from 'drizzle-orm'
import { createReadStream, existsSync } from 'fs'
import { db } from '../../db'
import { attachments } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '')
  if (isNaN(id)) {
    throw createError({ statusCode: 400, message: 'Invalid attachment ID' })
  }

  const attachment = db
    .select()
    .from(attachments)
    .where(eq(attachments.id, id))
    .get()

  if (!attachment) {
    throw createError({ statusCode: 404, message: 'Attachment not found' })
  }

  if (!existsSync(attachment.filePath)) {
    throw createError({ statusCode: 404, message: 'Attachment file not found on disk' })
  }

  // Set appropriate headers
  setHeader(event, 'Content-Type', attachment.mimeType || 'application/octet-stream')
  setHeader(event, 'Content-Disposition', `inline; filename="${attachment.filename}"`)
  if (attachment.size) {
    setHeader(event, 'Content-Length', attachment.size)
  }

  // Stream the file
  return sendStream(event, createReadStream(attachment.filePath))
})
