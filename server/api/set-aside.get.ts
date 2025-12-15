import { eq, desc, sql, and, isNotNull, notInArray } from 'drizzle-orm'
import { db } from '../db'
import { emails, contacts, attachments, emailContacts, emailThreads } from '../db/schema'
import { proxyImagesInHtml } from '../utils/proxy-images'
import { replaceCidReferences } from '../utils/replace-cid'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const limit = Math.min(parseInt(query.limit as string) || 10, 100)

  // Parse exclude list (IDs already loaded this session)
  const excludeParam = query.exclude as string || ''
  const excludeIds = excludeParam ? excludeParam.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id)) : []

  // Build where clause - emails from threads that are set aside
  const baseWhere = isNotNull(emailThreads.setAsideAt)
  const whereClause = excludeIds.length > 0
    ? and(baseWhere, notInArray(emails.id, excludeIds))
    : baseWhere

  // Get emails from threads that have setAsideAt set
  // Order: newest thread addition first, then by email date (newest first)
  const setAsideEmails = db
    .select({
      id: emails.id,
      threadId: emails.threadId,
      subject: emails.subject,
      contentText: emails.contentText,
      contentHtml: emails.contentHtml,
      sentAt: emails.sentAt,
      receivedAt: emails.receivedAt,
      readAt: emails.readAt,
      senderId: emails.senderId,
      headers: emails.headers,
      setAsideAt: emailThreads.setAsideAt,
    })
    .from(emails)
    .innerJoin(emailThreads, eq(emailThreads.id, emails.threadId))
    .where(whereClause)
    .orderBy(desc(emailThreads.setAsideAt), desc(emails.sentAt))
    .limit(limit + 1)
    .all()

  const hasMore = setAsideEmails.length > limit
  const emailList = hasMore ? setAsideEmails.slice(0, limit) : setAsideEmails

  // Get full details for each email
  const emailsWithDetails = emailList.map((email) => {
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

    // Process content - replace CID references and proxy images (sanitization done client-side)
    let content: string
    if (email.contentHtml) {
      const withCidReplaced = replaceCidReferences(email.contentHtml, email.id)
      content = proxyImagesInHtml(withCidReplaced)
    } else if (email.contentText?.trim()) {
      content = `<pre style="white-space: pre-wrap; font-family: inherit;">${email.contentText}</pre>`
    } else {
      content = ''
    }

    // Get non-inline attachments
    const emailAttachments = db
      .select({
        id: attachments.id,
        filename: attachments.filename,
        mimeType: attachments.mimeType,
        size: attachments.size,
      })
      .from(attachments)
      .where(and(
        eq(attachments.emailId, email.id),
        eq(attachments.isInline, false)
      ))
      .all()

    // Extract Reply-To from headers if present
    const headers = email.headers as Record<string, string> | null
    const replyToRaw = headers?.['reply-to']
    let replyTo: string | null = null
    if (replyToRaw) {
      try {
        const parsed = JSON.parse(replyToRaw)
        if (parsed && typeof parsed === 'object') {
          if (parsed.text) {
            replyTo = parsed.text
          } else if (Array.isArray(parsed.value)) {
            replyTo = parsed.value
              .map((v: { name?: string; address?: string }) =>
                v.name ? `${v.name} <${v.address}>` : v.address
              )
              .filter(Boolean)
              .join(', ')
          }
        }
      } catch {
        replyTo = replyToRaw
      }
    }

    return {
      id: email.id,
      threadId: email.threadId,
      subject: email.subject,
      content,
      sentAt: email.sentAt,
      receivedAt: email.receivedAt,
      isRead: !!email.readAt,
      sender: sender ? { id: sender.id, name: sender.name, email: sender.email, isMe: sender.isMe } : null,
      recipients,
      attachments: emailAttachments,
      replyTo,
      headers,
    }
  })

  return {
    emails: emailsWithDetails,
    hasMore,
  }
})
