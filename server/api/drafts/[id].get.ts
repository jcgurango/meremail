import { db } from '../../db'
import { emails, emailContacts, contacts, attachments } from '../../db/schema'
import { eq, and } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))

  if (!id || isNaN(id)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid draft ID',
    })
  }

  // Get the draft email
  const draft = db
    .select({
      id: emails.id,
      subject: emails.subject,
      contentText: emails.contentText,
      contentHtml: emails.contentHtml,
      senderId: emails.senderId,
      status: emails.status,
      threadId: emails.threadId,
    })
    .from(emails)
    .where(and(eq(emails.id, id), eq(emails.status, 'draft')))
    .get()

  if (!draft) {
    throw createError({
      statusCode: 404,
      message: 'Draft not found',
    })
  }

  // Get sender info
  const sender = db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
    })
    .from(contacts)
    .where(eq(contacts.id, draft.senderId))
    .get()

  // Get recipients
  const recipientsData = db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
      role: emailContacts.role,
    })
    .from(emailContacts)
    .innerJoin(contacts, eq(contacts.id, emailContacts.contactId))
    .where(and(
      eq(emailContacts.emailId, id),
      // Exclude 'from' role - that's the sender
    ))
    .all()
    .filter(r => r.role !== 'from')

  // Get attachments
  const attachmentsData = db
    .select({
      id: attachments.id,
      filename: attachments.filename,
      mimeType: attachments.mimeType,
      size: attachments.size,
      isInline: attachments.isInline,
    })
    .from(attachments)
    .where(eq(attachments.emailId, id))
    .all()

  return {
    id: draft.id,
    subject: draft.subject,
    contentText: draft.contentText,
    contentHtml: draft.contentHtml,
    threadId: draft.threadId,
    sender: sender || null,
    recipients: recipientsData.map(r => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
    })),
    attachments: attachmentsData.map(a => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      isInline: a.isInline,
    })),
  }
})
