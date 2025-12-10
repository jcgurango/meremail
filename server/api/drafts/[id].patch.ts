import { db } from '../../db'
import { emails, emailContacts } from '../../db/schema'
import { eq, and } from 'drizzle-orm'

interface Recipient {
  id?: number
  email: string
  name?: string
  role: 'to' | 'cc' | 'bcc'
}

interface DraftUpdateBody {
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

  const body = await readBody<DraftUpdateBody>(event)

  // Verify the email exists and is a draft
  const existing = db
    .select({ id: emails.id, status: emails.status })
    .from(emails)
    .where(eq(emails.id, id))
    .get()

  if (!existing) {
    throw createError({ statusCode: 404, message: 'Draft not found' })
  }

  if (existing.status !== 'draft') {
    throw createError({ statusCode: 400, message: 'Cannot edit a sent email' })
  }

  // Update the email fields
  const updates: Partial<typeof emails.$inferInsert> = {}
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
  if (body.recipients !== undefined) {
    // Remove existing recipients (except 'from')
    db.delete(emailContacts)
      .where(and(
        eq(emailContacts.emailId, id),
        eq(emailContacts.role, 'to')
      ))
      .run()
    db.delete(emailContacts)
      .where(and(
        eq(emailContacts.emailId, id),
        eq(emailContacts.role, 'cc')
      ))
      .run()
    db.delete(emailContacts)
      .where(and(
        eq(emailContacts.emailId, id),
        eq(emailContacts.role, 'bcc')
      ))
      .run()

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

    // Update sender if changed
    if (body.senderId !== undefined) {
      db.delete(emailContacts)
        .where(and(
          eq(emailContacts.emailId, id),
          eq(emailContacts.role, 'from')
        ))
        .run()
      db.insert(emailContacts)
        .values({
          emailId: id,
          contactId: body.senderId,
          role: 'from',
        })
        .onConflictDoNothing()
        .run()
    }
  }

  return { id, status: 'draft', updated: true }
})
