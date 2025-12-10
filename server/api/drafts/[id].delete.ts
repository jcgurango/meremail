import { db } from '../../db'
import { emails, emailContacts, attachments } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { config } from '../../config'

export default defineEventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '')
  if (isNaN(id)) {
    throw createError({ statusCode: 400, message: 'Invalid draft ID' })
  }

  // Verify it's a draft
  const draft = db
    .select({ id: emails.id, status: emails.status })
    .from(emails)
    .where(eq(emails.id, id))
    .get()

  if (!draft) {
    throw createError({ statusCode: 404, message: 'Draft not found' })
  }

  if (draft.status !== 'draft') {
    throw createError({ statusCode: 400, message: 'Can only delete drafts' })
  }

  // Get attachments to delete their files
  const draftAttachments = db
    .select({ id: attachments.id, filePath: attachments.filePath })
    .from(attachments)
    .where(eq(attachments.emailId, id))
    .all()

  // Delete attachment files from disk
  for (const att of draftAttachments) {
    if (att.filePath) {
      try {
        // filePath may be absolute/relative (imports) or just filename (uploads)
        // If it contains path separators or starts with './', it's a full path
        const fullPath = att.filePath.includes('/') || att.filePath.includes('\\')
          ? att.filePath
          : join(config.uploads.path, att.filePath)
        await unlink(fullPath)
      } catch (e) {
        // File may not exist, ignore
        console.warn(`Failed to delete attachment file: ${att.filePath}`)
      }
    }
  }

  // Delete attachments from database
  db.delete(attachments)
    .where(eq(attachments.emailId, id))
    .run()

  // Delete email_contacts entries
  db.delete(emailContacts)
    .where(eq(emailContacts.emailId, id))
    .run()

  // Delete the draft
  db.delete(emails)
    .where(eq(emails.id, id))
    .run()

  return { success: true }
})
