import { eq, desc } from 'drizzle-orm'
import { db } from '../../db'
import { emails, emailThreads, contacts, emailContacts, attachments } from '../../db/schema'
import { proxyImagesInHtml } from '../../utils/proxy-images'
import { sanitizeEmailHtml } from '../../utils/sanitize-email-html'
import { replaceCidReferences } from '../../utils/replace-cid'

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
      headers: emails.headers,
      messageId: emails.messageId,
      references: emails.references,
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
    // Pipeline: sanitize -> replace CID references -> proxy external images
    let content: string
    if (email.contentHtml) {
      const sanitized = sanitizeEmailHtml(email.contentHtml)
      const withCidReplaced = replaceCidReferences(sanitized, email.id)
      content = proxyImagesInHtml(withCidReplaced)
    } else if (email.contentText?.trim()) {
      content = `<pre style="white-space: pre-wrap; font-family: inherit;">${email.contentText}</pre>`
    } else {
      content = ''
    }

    // Get non-inline attachments for this email (inline ones are embedded in HTML)
    const emailAttachments = db
      .select({
        id: attachments.id,
        filename: attachments.filename,
        mimeType: attachments.mimeType,
        size: attachments.size,
        isInline: attachments.isInline,
      })
      .from(attachments)
      .where(eq(attachments.emailId, email.id))
      .all()
      .filter((a) => !a.isInline)

    // Extract Reply-To from headers if present
    const headers = email.headers as Record<string, string> | null
    const replyToRaw = headers?.['reply-to']
    let replyTo: string | null = null
    if (replyToRaw) {
      // reply-to header was JSON.stringified during import if it was an object
      // Try to parse and extract the text representation
      try {
        const parsed = JSON.parse(replyToRaw)
        if (parsed && typeof parsed === 'object') {
          // mailparser format: { value: [{address, name}], text: "...", html: "..." }
          if (parsed.text) {
            replyTo = parsed.text
          } else if (Array.isArray(parsed.value)) {
            // Fallback: format from value array
            replyTo = parsed.value
              .map((v: { name?: string; address?: string }) =>
                v.name ? `${v.name} <${v.address}>` : v.address
              )
              .filter(Boolean)
              .join(', ')
          }
        }
      } catch {
        // Not JSON, use as-is (plain string header)
        replyTo = replyToRaw
      }
    }

    return {
      id: email.id,
      subject: email.subject,
      content,
      contentText: email.contentText,  // Plain text for quoting
      sentAt: email.sentAt,
      receivedAt: email.receivedAt,
      isRead: email.isRead,
      sender: sender ? { id: sender.id, name: sender.name, email: sender.email, isMe: sender.isMe } : null,
      recipients,
      attachments: emailAttachments,
      replyTo,
      headers,
      messageId: email.messageId,
      references: email.references,
    }
  })

  // Mark all emails in thread as read
  db.update(emails)
    .set({ isRead: true })
    .where(eq(emails.threadId, id))
    .run()

  // Find the first "me" identity in this thread (for default From)
  let defaultFromId: number | null = null
  for (const email of emailsWithParticipants) {
    if (email.sender?.isMe) {
      defaultFromId = email.sender.id
      break
    }
    // Check recipients too
    const meRecipient = email.recipients.find(r => r.isMe)
    if (meRecipient) {
      defaultFromId = meRecipient.id
      break
    }
  }

  return {
    id: thread.id,
    subject: thread.subject,
    createdAt: thread.createdAt,
    emails: emailsWithParticipants,
    defaultFromId,
  }
})
