import { db } from '../../db'
import { emails, emailContacts } from '../../db/schema'
import { eq, and } from 'drizzle-orm'

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
