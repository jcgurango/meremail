import { eq, desc, sql, and } from 'drizzle-orm'
import { db } from '../db'
import { emails, contacts, attachments } from '../db/schema'
import { proxyImagesInHtml } from '../utils/proxy-images'
import { sanitizeEmailHtml } from '../utils/sanitize-email-html'
import { replaceCidReferences } from '../utils/replace-cid'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const limit = Math.min(parseInt(query.limit as string) || 10, 100)
  const offset = parseInt(query.offset as string) || 0
  const bucket = query.bucket as string || 'feed'

  // Validate bucket
  if (bucket !== 'feed' && bucket !== 'paper_trail') {
    throw createError({ statusCode: 400, message: 'Invalid bucket. Must be "feed" or "paper_trail"' })
  }

  // Get emails from contacts with the specified bucket, ordered by date
  const feedEmails = db
    .select({
      id: emails.id,
      threadId: emails.threadId,
      subject: emails.subject,
      contentText: emails.contentText,
      contentHtml: emails.contentHtml,
      sentAt: emails.sentAt,
      receivedAt: emails.receivedAt,
      isRead: emails.isRead,
      senderId: emails.senderId,
    })
    .from(emails)
    .innerJoin(contacts, eq(contacts.id, emails.senderId))
    .where(eq(contacts.bucket, bucket))
    .orderBy(desc(emails.sentAt))
    .limit(limit + 1)
    .offset(offset)
    .all()

  const hasMore = feedEmails.length > limit
  const emailList = hasMore ? feedEmails.slice(0, limit) : feedEmails

  // Get full details for each email
  const emailsWithDetails = emailList.map((email) => {
    // Get sender
    const sender = email.senderId
      ? db.select().from(contacts).where(eq(contacts.id, email.senderId)).get()
      : null

    // Process content
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

    return {
      id: email.id,
      threadId: email.threadId,
      subject: email.subject,
      content,
      sentAt: email.sentAt,
      receivedAt: email.receivedAt,
      isRead: email.isRead,
      sender: sender ? { id: sender.id, name: sender.name, email: sender.email, isMe: sender.isMe } : null,
      attachments: emailAttachments,
    }
  })

  // Mark these emails as read
  if (emailList.length > 0) {
    const emailIds = emailList.map(e => e.id)
    db.update(emails)
      .set({ isRead: true })
      .where(sql`${emails.id} IN (${sql.join(emailIds.map(id => sql`${id}`), sql`, `)})`)
      .run()
  }

  return {
    emails: emailsWithDetails,
    hasMore,
  }
})
