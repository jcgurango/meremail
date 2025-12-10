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
  subject: string
  contentText: string
  contentHtml?: string
  inReplyTo?: string
  references?: string[]
  recipients: Recipient[]
}

export default defineEventHandler(async (event) => {
  const body = await readBody<DraftBody>(event)

  if (!body.threadId || !body.senderId || !body.subject || !body.contentText) {
    throw createError({
      statusCode: 400,
      message: 'Missing required fields: threadId, senderId, subject, contentText',
    })
  }

  if (!body.recipients || body.recipients.length === 0) {
    throw createError({
      statusCode: 400,
      message: 'At least one recipient is required',
    })
  }

  // Create the draft email
  const result = db
    .insert(emails)
    .values({
      threadId: body.threadId,
      senderId: body.senderId,
      subject: body.subject,
      contentText: body.contentText,
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
  for (const recipient of body.recipients) {
    if (recipient.id) {
      // Existing contact
      db.insert(emailContacts)
        .values({
          emailId,
          contactId: recipient.id,
          role: recipient.role,
        })
        .onConflictDoNothing()
        .run()
    }
    // For new/raw emails without contact ID, we'd need to create contacts
    // For now, we require existing contacts or will handle raw emails differently
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
  for (const r of body.recipients) {
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
