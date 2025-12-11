import { eq, desc, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { emails, emailThreads, contacts, emailContacts, attachments } from '../../db/schema'
import { proxyImagesInHtml } from '../../utils/proxy-images'
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

  // Get all emails in the thread
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
      status: emails.status,
      inReplyTo: emails.inReplyTo,
    })
    .from(emails)
    .where(eq(emails.threadId, id))
    .orderBy(desc(emails.sentAt))
    .all()

  // Collect IDs for batch loading
  const emailIds = threadEmails.map(e => e.id)
  const senderIds = [...new Set(threadEmails.map(e => e.senderId).filter(Boolean))] as number[]

  // Batch load all senders
  const sendersMap = new Map<number, { id: number; name: string | null; email: string; isMe: boolean }>()
  if (senderIds.length > 0) {
    const senders = db
      .select({ id: contacts.id, name: contacts.name, email: contacts.email, isMe: contacts.isMe })
      .from(contacts)
      .where(inArray(contacts.id, senderIds))
      .all()
    for (const s of senders) {
      sendersMap.set(s.id, s)
    }
  }

  // Batch load all recipients
  const recipientsMap = new Map<number, Array<{ id: number; name: string | null; email: string; isMe: boolean; role: string }>>()
  if (emailIds.length > 0) {
    const allRecipients = db
      .select({
        emailId: emailContacts.emailId,
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        isMe: contacts.isMe,
        role: emailContacts.role,
      })
      .from(emailContacts)
      .innerJoin(contacts, eq(contacts.id, emailContacts.contactId))
      .where(inArray(emailContacts.emailId, emailIds))
      .all()
    for (const r of allRecipients) {
      if (r.role === 'from') continue // Skip 'from' role
      const list = recipientsMap.get(r.emailId) || []
      list.push({ id: r.id, name: r.name, email: r.email, isMe: r.isMe, role: r.role })
      recipientsMap.set(r.emailId, list)
    }
  }

  // Batch load all non-inline attachments
  const attachmentsMap = new Map<number, Array<{ id: number; filename: string; mimeType: string | null; size: number | null; isInline: boolean }>>()
  if (emailIds.length > 0) {
    const allAttachments = db
      .select({
        emailId: attachments.emailId,
        id: attachments.id,
        filename: attachments.filename,
        mimeType: attachments.mimeType,
        size: attachments.size,
        isInline: attachments.isInline,
      })
      .from(attachments)
      .where(inArray(attachments.emailId, emailIds))
      .all()
    for (const a of allAttachments) {
      if (a.isInline) continue // Skip inline attachments
      const list = attachmentsMap.get(a.emailId) || []
      list.push({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size, isInline: a.isInline })
      attachmentsMap.set(a.emailId, list)
    }
  }

  // Build response using maps (no queries in loop)
  const emailsWithParticipants = threadEmails.map((email) => {
    const sender = email.senderId ? sendersMap.get(email.senderId) || null : null
    const recipients = recipientsMap.get(email.id) || []
    const emailAttachments = attachmentsMap.get(email.id) || []

    // Prefer HTML for rendering, fall back to text (wrapped in pre for formatting)
    // Pipeline: replace CID references -> proxy external images (sanitization done client-side)
    let content: string
    if (email.contentHtml) {
      const withCidReplaced = replaceCidReferences(email.contentHtml, email.id)
      content = proxyImagesInHtml(withCidReplaced)
    } else if (email.contentText?.trim()) {
      content = `<pre style="white-space: pre-wrap; font-family: inherit;">${email.contentText}</pre>`
    } else {
      content = ''
    }

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
      contentHtml: email.contentHtml,  // HTML for editing drafts
      sentAt: email.sentAt,
      receivedAt: email.receivedAt,
      isRead: email.isRead,
      status: email.status,
      sender: sender ? { id: sender.id, name: sender.name, email: sender.email, isMe: sender.isMe } : null,
      recipients,
      attachments: emailAttachments,
      replyTo,
      headers,
      messageId: email.messageId,
      references: email.references,
      inReplyTo: email.inReplyTo,
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
    replyLater: thread.replyLater,
    emails: emailsWithParticipants,
    defaultFromId,
  }
})
