import { eq } from 'drizzle-orm'
import { db } from '../../../db'
import { attachments, emails, emailThreads, contacts } from '../../../db/schema'

export default defineEventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '')
  if (isNaN(id)) {
    throw createError({ statusCode: 400, message: 'Invalid attachment ID' })
  }

  const attachment = db
    .select({
      id: attachments.id,
      filename: attachments.filename,
      mimeType: attachments.mimeType,
      size: attachments.size,
      filePath: attachments.filePath,
      isInline: attachments.isInline,
      extractedText: attachments.extractedText,
      createdAt: attachments.createdAt,
      emailId: attachments.emailId,
    })
    .from(attachments)
    .where(eq(attachments.id, id))
    .get()

  if (!attachment) {
    throw createError({ statusCode: 404, message: 'Attachment not found' })
  }

  // Get email and thread info
  const email = db
    .select({
      id: emails.id,
      subject: emails.subject,
      sentAt: emails.sentAt,
      threadId: emails.threadId,
      senderId: emails.senderId,
    })
    .from(emails)
    .where(eq(emails.id, attachment.emailId))
    .get()

  if (!email) {
    throw createError({ statusCode: 404, message: 'Email not found' })
  }

  const thread = email.threadId
    ? db
        .select({
          id: emailThreads.id,
          subject: emailThreads.subject,
        })
        .from(emailThreads)
        .where(eq(emailThreads.id, email.threadId))
        .get()
    : null

  const sender = email.senderId
    ? db.select().from(contacts).where(eq(contacts.id, email.senderId)).get()
    : null

  return {
    id: attachment.id,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size,
    isInline: attachment.isInline,
    extractedText: attachment.extractedText,
    createdAt: attachment.createdAt,
    email: {
      id: email.id,
      subject: email.subject,
      sentAt: email.sentAt,
    },
    thread: thread ? {
      id: thread.id,
      subject: thread.subject,
    } : null,
    sender: sender ? {
      id: sender.id,
      name: sender.name,
      email: sender.email,
    } : null,
  }
})
