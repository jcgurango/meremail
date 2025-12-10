import { eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { emails, emailThreads, contacts } from '../../db/schema'

// Debug endpoint to check thread/email relationships
export default defineEventHandler(async (event) => {
  // Get all threads with their email counts by folder
  const threads = db
    .select({
      id: emailThreads.id,
      subject: emailThreads.subject,
    })
    .from(emailThreads)
    .all()

  const threadDetails = threads.map((thread) => {
    const threadEmails = db
      .select({
        id: emails.id,
        folder: emails.folder,
        messageId: emails.messageId,
        inReplyTo: emails.inReplyTo,
        subject: emails.subject,
        senderId: emails.senderId,
        sentAt: emails.sentAt,
      })
      .from(emails)
      .where(eq(emails.threadId, thread.id))
      .all()

    const emailsWithSender = threadEmails.map((email) => {
      const sender = email.senderId
        ? db.select().from(contacts).where(eq(contacts.id, email.senderId)).get()
        : null
      return {
        ...email,
        senderEmail: sender?.email,
        senderIsMe: sender?.isMe,
      }
    })

    return {
      threadId: thread.id,
      subject: thread.subject,
      emailCount: threadEmails.length,
      folders: [...new Set(threadEmails.map((e) => e.folder))],
      emails: emailsWithSender,
    }
  })

  // Also find potential orphaned sent emails (sent emails that might belong to other threads)
  const sentEmails = db
    .select({
      id: emails.id,
      threadId: emails.threadId,
      folder: emails.folder,
      messageId: emails.messageId,
      inReplyTo: emails.inReplyTo,
      subject: emails.subject,
    })
    .from(emails)
    .where(eq(emails.folder, 'Sent'))
    .all()

  // Check if any sent email's inReplyTo matches an email in a different thread
  const potentialMislinks = sentEmails
    .filter((sent) => sent.inReplyTo)
    .map((sent) => {
      const referencedEmail = db
        .select({ id: emails.id, threadId: emails.threadId })
        .from(emails)
        .where(eq(emails.messageId, sent.inReplyTo!))
        .get()

      if (referencedEmail && referencedEmail.threadId !== sent.threadId) {
        return {
          sentEmailId: sent.id,
          sentThreadId: sent.threadId,
          inReplyTo: sent.inReplyTo,
          shouldBeInThread: referencedEmail.threadId,
        }
      }
      return null
    })
    .filter(Boolean)

  // Find emails with inReplyTo that don't match any imported email
  const allEmails = db
    .select({
      id: emails.id,
      threadId: emails.threadId,
      folder: emails.folder,
      messageId: emails.messageId,
      inReplyTo: emails.inReplyTo,
      subject: emails.subject,
    })
    .from(emails)
    .all()

  const allMessageIds = new Set(allEmails.map((e) => e.messageId).filter(Boolean))

  const unmatchedReplies = allEmails
    .filter((e) => e.inReplyTo && !allMessageIds.has(e.inReplyTo))
    .map((e) => ({
      id: e.id,
      folder: e.folder,
      subject: e.subject,
      inReplyTo: e.inReplyTo,
      note: 'inReplyTo references an email not in database',
    }))

  return {
    threadCount: threads.length,
    threads: threadDetails.slice(0, 20), // Limit for readability
    potentialMislinks,
    unmatchedReplies: unmatchedReplies.slice(0, 20),
  }
})
