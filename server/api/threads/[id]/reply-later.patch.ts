import { eq, and, inArray } from 'drizzle-orm'
import { db } from '../../../db'
import { emailThreads, emails, emailContacts, attachments } from '../../../db/schema'

export default defineEventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '')
  if (isNaN(id)) {
    throw createError({ statusCode: 400, message: 'Invalid thread ID' })
  }

  const body = await readBody(event)
  const replyLater = body?.replyLater
  const deleteDrafts = body?.deleteDrafts === true

  if (typeof replyLater !== 'boolean') {
    throw createError({ statusCode: 400, message: 'replyLater must be a boolean' })
  }

  // Check for drafts if removing from reply later
  if (!replyLater) {
    const drafts = db.select({ id: emails.id })
      .from(emails)
      .where(and(eq(emails.threadId, id), eq(emails.status, 'draft')))
      .all()

    if (drafts.length > 0 && !deleteDrafts) {
      // Return info about drafts so client can confirm deletion
      return {
        success: false,
        requiresConfirmation: true,
        draftCount: drafts.length,
        message: `This thread has ${drafts.length} draft${drafts.length > 1 ? 's' : ''}. Removing from Reply Later will delete them.`
      }
    }

    // Delete drafts if confirmed - must delete related records first (foreign keys)
    if (drafts.length > 0 && deleteDrafts) {
      const draftIds = drafts.map(d => d.id)

      // Delete email contacts (to, cc, bcc, from relationships)
      db.delete(emailContacts)
        .where(inArray(emailContacts.emailId, draftIds))
        .run()

      // Delete attachments
      db.delete(attachments)
        .where(inArray(attachments.emailId, draftIds))
        .run()

      // Now delete the drafts themselves
      db.delete(emails)
        .where(inArray(emails.id, draftIds))
        .run()
    }
  }

  // Update the thread - set timestamp when adding, null when removing
  const replyLaterAt = replyLater ? new Date() : null

  db.update(emailThreads)
    .set({ replyLaterAt })
    .where(eq(emailThreads.id, id))
    .run()

  return { success: true, replyLater, replyLaterAt }
})
