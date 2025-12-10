import { eq } from 'drizzle-orm'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { db } from '../../db'
import { attachments, emails } from '../../db/schema'
import { config } from '../../config'

export default defineEventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '')
  if (isNaN(id)) {
    throw createError({ statusCode: 400, message: 'Invalid attachment ID' })
  }

  const attachment = db
    .select({
      id: attachments.id,
      emailId: attachments.emailId,
      filePath: attachments.filePath,
    })
    .from(attachments)
    .where(eq(attachments.id, id))
    .get()

  if (!attachment) {
    throw createError({ statusCode: 404, message: 'Attachment not found' })
  }

  // Verify the parent email is a draft (can only delete attachments from drafts)
  const email = db
    .select({ status: emails.status })
    .from(emails)
    .where(eq(emails.id, attachment.emailId))
    .get()

  if (!email) {
    throw createError({ statusCode: 404, message: 'Parent email not found' })
  }

  if (email.status !== 'draft') {
    throw createError({ statusCode: 400, message: 'Can only delete attachments from drafts' })
  }

  // Delete file from disk
  if (attachment.filePath) {
    try {
      // filePath may be absolute/relative (imports) or just filename (uploads)
      const fullPath = attachment.filePath.includes('/') || attachment.filePath.includes('\\')
        ? attachment.filePath
        : join(config.uploads.path, attachment.filePath)
      await unlink(fullPath)
    } catch (e) {
      // File may not exist, continue with DB deletion
      console.warn(`Failed to delete attachment file: ${attachment.filePath}`)
    }
  }

  // Delete from database
  db.delete(attachments)
    .where(eq(attachments.id, id))
    .run()

  return { success: true }
})
