import { db } from '../../db'
import { emails, emailContacts } from '../../db/schema'
import { eq } from 'drizzle-orm'

interface Recipient {
  id?: number
  email: string
  name?: string
  role: 'to' | 'cc' | 'bcc'
}

interface DraftBody {
  senderId?: number
  subject?: string
  contentText?: string
  contentHtml?: string
  recipients?: Recipient[]
}

export default defineEventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '')
  if (isNaN(id)) {
    throw createError({ statusCode: 400, message: 'Invalid draft ID' })
  }

  const body = await readBody<DraftBody>(event)

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
    throw createError({ statusCode: 400, message: 'Can only update drafts' })
  }

  // Update the draft
  const updates: Record<string, unknown> = {}
  if (body.senderId !== undefined) updates.senderId = body.senderId
  if (body.subject !== undefined) updates.subject = body.subject
  if (body.contentText !== undefined) updates.contentText = body.contentText
  if (body.contentHtml !== undefined) updates.contentHtml = body.contentHtml

  if (Object.keys(updates).length > 0) {
    db.update(emails)
      .set(updates)
      .where(eq(emails.id, id))
      .run()
  }

  // Update recipients if provided
  if (body.recipients) {
    // Remove old recipients (except 'from')
    db.delete(emailContacts)
      .where(eq(emailContacts.emailId, id))
      .run()

    // Add sender as 'from'
    if (body.senderId) {
      db.insert(emailContacts)
        .values({
          emailId: id,
          contactId: body.senderId,
          role: 'from',
        })
        .onConflictDoNothing()
        .run()
    }

    // Add new recipients
    for (const recipient of body.recipients) {
      if (recipient.id) {
        db.insert(emailContacts)
          .values({
            emailId: id,
            contactId: recipient.id,
            role: recipient.role,
          })
          .onConflictDoNothing()
          .run()
      }
    }
  }

  return { id, status: 'draft' }
})
