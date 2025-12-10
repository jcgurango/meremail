import { eq, desc } from 'drizzle-orm'
import { db } from '../../db'
import { emails, emailThreads, contacts, emailContacts } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '')
  if (isNaN(id)) {
    throw createError({ statusCode: 400, message: 'Invalid thread ID' })
  }

  // Get the thread
  const thread = db
    .select()
    .from(emailThreads)
    .where(eq(emailThreads.id, id))
    .get()

  if (!thread) {
    throw createError({ statusCode: 404, message: 'Thread not found' })
  }

  // Get all emails in the thread with their participants
  const threadEmails = db
    .select({
      id: emails.id,
      subject: emails.subject,
      contentText: emails.contentText,
      contentHtml: emails.contentHtml,
      sentAt: emails.sentAt,
      receivedAt: emails.receivedAt,
      isRead: emails.isRead,
      senderId: emails.senderId,
    })
    .from(emails)
    .where(eq(emails.threadId, id))
    .orderBy(emails.sentAt)
    .all()

  // Get sender info and recipients for each email
  const emailsWithParticipants = threadEmails.map((email) => {
    // Get sender
    const sender = email.senderId
      ? db.select().from(contacts).where(eq(contacts.id, email.senderId)).get()
      : null

    // Get recipients (to, cc, bcc)
    const recipients = db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        isMe: contacts.isMe,
        role: emailContacts.role,
      })
      .from(emailContacts)
      .innerJoin(contacts, eq(contacts.id, emailContacts.contactId))
      .where(eq(emailContacts.emailId, email.id))
      .all()
      .filter((r) => r.role !== 'from')

    // Prefer HTML for rendering, fall back to text (wrapped in pre for formatting)
    const content = email.contentHtml || `<pre style="white-space: pre-wrap; font-family: inherit;">${email.contentText}</pre>`

    return {
      id: email.id,
      subject: email.subject,
      content,
      sentAt: email.sentAt,
      receivedAt: email.receivedAt,
      isRead: email.isRead,
      sender: sender ? { id: sender.id, name: sender.name, email: sender.email, isMe: sender.isMe } : null,
      recipients,
    }
  })

  // Mark all emails in thread as read
  db.update(emails)
    .set({ isRead: true })
    .where(eq(emails.threadId, id))
    .run()

  return {
    id: thread.id,
    subject: thread.subject,
    createdAt: thread.createdAt,
    emails: emailsWithParticipants,
  }
})
