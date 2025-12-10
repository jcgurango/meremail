import { db } from '../db'
import { emails, emailContacts, emailThreadContacts } from '../db/schema'
import { eq } from 'drizzle-orm'

interface Recipient {
  id?: number  // Contact ID if from existing contact
  email: string
  name?: string
  role: 'to' | 'cc' | 'bcc'
}

interface DraftBody {
  threadId: number
  senderId: number  // The "me" contact to send from
  subject?: string
  contentText?: string
  contentHtml?: string
  inReplyTo?: string
  references?: string[]
  recipients?: Recipient[]
}

export default defineEventHandler(async (event) => {
  const body = await readBody<DraftBody>(event)

  if (!body.threadId || !body.senderId) {
    throw createError({
      statusCode: 400,
      message: 'Missing required fields: threadId, senderId',
    })
  }

  // Recipients are optional for drafts - they're a work in progress

  // Create the draft email
  const result = db
    .insert(emails)
    .values({
      threadId: body.threadId,
      senderId: body.senderId,
      subject: body.subject || '',
      contentText: body.contentText || '',
      contentHtml: body.contentHtml || null,
      inReplyTo: body.inReplyTo || null,
      references: body.references || null,
      status: 'draft',
      folder: 'Drafts',
      isRead: true,
    })
    .returning({ id: emails.id })
    .get()

  const emailId = result.id

  // Add recipients to email_contacts junction table
  const recipients = body.recipients || []
  for (const recipient of recipients) {
    if (recipient.id) {
      db.insert(emailContacts)
        .values({
          emailId,
          contactId: recipient.id,
          role: recipient.role,
        })
        .onConflictDoNothing()
        .run()
    }
  }

  // Add sender to email_contacts as 'from'
  db.insert(emailContacts)
    .values({
      emailId,
      contactId: body.senderId,
      role: 'from',
    })
    .onConflictDoNothing()
    .run()

  // Update email_thread_contacts junction
  const allContactIds = new Set<number>([body.senderId])
  for (const r of recipients) {
    if (r.id) allContactIds.add(r.id)
  }

  for (const contactId of allContactIds) {
    db.insert(emailThreadContacts)
      .values({
        threadId: body.threadId,
        contactId,
        role: contactId === body.senderId ? 'sender' : 'recipient',
      })
      .onConflictDoNothing()
      .run()
  }

  return { id: emailId, status: 'draft' }
})
