import { eq, and, or, isNull, lte, inArray, sql } from 'drizzle-orm'
import { db, emails, emailContacts, contacts, attachments, emailThreads, resolveAttachmentPath } from '@meremail/shared'
import { sendEmail, generateMessageId } from '@meremail/shared/services'
import type { SendableEmail, EmailRecipient } from '@meremail/shared/services'

// Retry intervals in milliseconds: 1m, 5m, 15m, 1h, 4h
const RETRY_INTERVALS = [
  1 * 60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  4 * 60 * 60 * 1000,
]
const MAX_ATTEMPTS = 5

/**
 * Format a date in the standard email reply format
 * e.g., "Mon, Jan 15, 2024 at 2:30 PM"
 */
function formatReplyDate(date: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }
  return date.toLocaleString('en-US', options)
}

/**
 * Format the sender for the reply header
 * e.g., "Sarah Chen <sarah@example.com>"
 */
function formatSenderForQuote(name: string | null, email: string): string {
  if (name) {
    return `${name} <${email}>`
  }
  return email
}

/**
 * Quote text content by adding > prefix to each line
 */
function quoteTextContent(text: string): string {
  return text
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')
}

/**
 * Build the quoted reply content for text
 * Format: "On Mon, Jan 15, 2024 at 2:30 PM, Sarah Chen <sarah@example.com> wrote:"
 */
function buildTextQuote(originalDate: Date, senderName: string | null, senderEmail: string, originalText: string): string {
  const dateStr = formatReplyDate(originalDate)
  const sender = formatSenderForQuote(senderName, senderEmail)
  const header = `On ${dateStr}, ${sender} wrote:`
  const quotedContent = quoteTextContent(originalText)
  return `\n\n${header}\n${quotedContent}`
}

/**
 * Build the quoted reply content for HTML
 * Uses standard email blockquote styling
 */
function buildHtmlQuote(originalDate: Date, senderName: string | null, senderEmail: string, originalHtml: string): string {
  const dateStr = formatReplyDate(originalDate)
  const sender = senderName
    ? `${senderName} &lt;${senderEmail}&gt;`
    : senderEmail

  return `
<br><br>
<div class="gmail_quote">
  <div dir="ltr" class="gmail_attr">On ${dateStr}, ${sender} wrote:</div>
  <blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">
    ${originalHtml}
  </blockquote>
</div>`
}

/**
 * Build a sendable email from database records
 */
async function buildSendableEmail(emailId: number): Promise<SendableEmail | null> {
  // Get the email
  const email = db
    .select({
      id: emails.id,
      subject: emails.subject,
      contentText: emails.contentText,
      contentHtml: emails.contentHtml,
      inReplyTo: emails.inReplyTo,
      references: emails.references,
    })
    .from(emails)
    .where(eq(emails.id, emailId))
    .get()

  if (!email) return null

  // Get sender (role = 'from')
  const senderData = db
    .select({
      name: contacts.name,
      email: contacts.email,
    })
    .from(emailContacts)
    .innerJoin(contacts, eq(contacts.id, emailContacts.contactId))
    .where(and(eq(emailContacts.emailId, emailId), eq(emailContacts.role, 'from')))
    .get()

  if (!senderData) return null

  // Get recipients (to, cc, bcc)
  const recipientsData = db
    .select({
      name: contacts.name,
      email: contacts.email,
      role: emailContacts.role,
    })
    .from(emailContacts)
    .innerJoin(contacts, eq(contacts.id, emailContacts.contactId))
    .where(eq(emailContacts.emailId, emailId))
    .all()
    .filter(r => r.role !== 'from')

  const to: EmailRecipient[] = []
  const cc: EmailRecipient[] = []
  const bcc: EmailRecipient[] = []

  for (const r of recipientsData) {
    const recipient: EmailRecipient = {
      email: r.email,
      name: r.name || undefined,
    }
    if (r.role === 'to') to.push(recipient)
    else if (r.role === 'cc') cc.push(recipient)
    else if (r.role === 'bcc') bcc.push(recipient)
  }

  // Get attachments
  const attachmentsData = db
    .select({
      filename: attachments.filename,
      filePath: attachments.filePath,
      mimeType: attachments.mimeType,
      contentId: attachments.contentId,
    })
    .from(attachments)
    .where(eq(attachments.emailId, emailId))
    .all()

  // Build the content with quoted original if this is a reply
  let finalText = email.contentText
  let finalHtml = email.contentHtml || undefined

  if (email.inReplyTo) {
    // Find the original email by messageId
    const originalEmail = db
      .select({
        id: emails.id,
        sentAt: emails.sentAt,
        contentText: emails.contentText,
        contentHtml: emails.contentHtml,
        senderId: emails.senderId,
      })
      .from(emails)
      .where(eq(emails.messageId, email.inReplyTo))
      .get()

    if (originalEmail && originalEmail.senderId) {
      // Get the original sender
      const originalSender = db
        .select({
          name: contacts.name,
          email: contacts.email,
        })
        .from(contacts)
        .where(eq(contacts.id, originalEmail.senderId))
        .get()

      if (originalSender && originalEmail.sentAt) {
        const originalDate = originalEmail.sentAt

        // Append quoted text content
        if (originalEmail.contentText) {
          finalText += buildTextQuote(
            originalDate,
            originalSender.name,
            originalSender.email,
            originalEmail.contentText
          )
        }

        // Append quoted HTML content
        if (originalEmail.contentHtml) {
          const baseHtml = finalHtml || `<div>${email.contentText.replace(/\n/g, '<br>')}</div>`
          finalHtml = baseHtml + buildHtmlQuote(
            originalDate,
            originalSender.name,
            originalSender.email,
            originalEmail.contentHtml
          )
        }
      }
    }
  }

  return {
    from: {
      email: senderData.email,
      name: senderData.name || undefined,
    },
    to,
    cc,
    bcc,
    subject: email.subject,
    text: finalText,
    html: finalHtml,
    inReplyTo: email.inReplyTo || undefined,
    references: email.references || undefined,
    attachments: attachmentsData.map(a => ({
      filename: a.filename,
      path: resolveAttachmentPath(a.filePath),
      contentType: a.mimeType || undefined,
      cid: a.contentId || undefined,
    })),
  }
}

/**
 * Process all queued emails that are ready to be sent
 */
export async function processQueuedEmails(): Promise<{ processed: number; errors: number }> {
  const now = new Date()
  let processed = 0
  let errors = 0

  // Find all queued emails
  const queuedEmails = db
    .select({
      id: emails.id,
      threadId: emails.threadId,
      sendAttempts: emails.sendAttempts,
      lastSendAttemptAt: emails.lastSendAttemptAt,
    })
    .from(emails)
    .where(eq(emails.status, 'queued'))
    .all()

  for (const email of queuedEmails) {
    const attempts = email.sendAttempts || 0

    // Check if we've exceeded max attempts
    if (attempts >= MAX_ATTEMPTS) {
      continue // Skip - will stay in queued state for manual intervention
    }

    // Check backoff timing
    if (attempts > 0 && email.lastSendAttemptAt) {
      const backoffIndex = Math.min(attempts - 1, RETRY_INTERVALS.length - 1)
      const backoffMs = RETRY_INTERVALS[backoffIndex] ?? RETRY_INTERVALS[RETRY_INTERVALS.length - 1]!
      const nextAttemptAt = new Date(email.lastSendAttemptAt.getTime() + backoffMs)
      if (now < nextAttemptAt) {
        continue // Not ready to retry yet
      }
    }

    try {
      // Build the sendable email
      const sendable = await buildSendableEmail(email.id)
      if (!sendable) {
        throw new Error('Failed to build email - missing data')
      }

      // Send via SMTP
      const result = await sendEmail(sendable)

      // Update email to sent status
      db.update(emails)
        .set({
          status: 'sent',
          messageId: result.messageId,
          sentAt: now,
          folder: 'sent',
          lastSendError: null,
        })
        .where(eq(emails.id, email.id))
        .run()

      // If this was a reply in a thread, check if we should unflag reply-later
      if (email.threadId) {
        // Check if there are any remaining drafts or queued emails in this thread
        const remainingDrafts = db
          .select({ id: emails.id })
          .from(emails)
          .where(and(
            eq(emails.threadId, email.threadId),
            inArray(emails.status, ['draft', 'queued'])
          ))
          .all()

        // If no more drafts, unflag reply-later on the thread
        if (remainingDrafts.length === 0) {
          db.update(emailThreads)
            .set({ replyLaterAt: null })
            .where(eq(emailThreads.id, email.threadId))
            .run()
          console.log(`[SendQueue] Unflagged reply-later on thread ${email.threadId}`)
        }
      }

      processed++
      console.log(`[SendQueue] Successfully sent email ${email.id}`)
    } catch (error) {
      // Update attempt count and error
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      db.update(emails)
        .set({
          sendAttempts: attempts + 1,
          lastSendAttemptAt: now,
          lastSendError: errorMessage,
        })
        .where(eq(emails.id, email.id))
        .run()

      errors++
      console.error(`[SendQueue] Failed to send email ${email.id}:`, errorMessage)
    }
  }

  return { processed, errors }
}

/**
 * Start the background send queue processor
 * Runs every 30 seconds
 */
export function startSendQueueProcessor(): void {
  const INTERVAL = 30 * 1000 // 30 seconds

  // Process immediately on startup
  processQueuedEmails()
    .then(result => {
      if (result.processed > 0 || result.errors > 0) {
        console.log(`[SendQueue] Initial run - Processed: ${result.processed}, Errors: ${result.errors}`)
      }
    })
    .catch(err => console.error('[SendQueue] Error in initial run:', err))

  // Then run on interval
  setInterval(async () => {
    try {
      const result = await processQueuedEmails()
      if (result.processed > 0 || result.errors > 0) {
        console.log(`[SendQueue] Processed: ${result.processed}, Errors: ${result.errors}`)
      }
    } catch (error) {
      console.error('[SendQueue] Error processing queue:', error)
    }
  }, INTERVAL)

  console.log('[SendQueue] Background processor started (30s interval)')
}
