import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { eq, or } from 'drizzle-orm'
import { db } from '../db'
import {
  emails,
  emailThreads,
  contacts,
  emailContacts,
  emailThreadContacts,
  attachments,
} from '../db/schema'
import type { ImportableEmail, EmailAddress, EmailAttachment } from '../types/email'

const ATTACHMENTS_DIR = process.env.ATTACHMENTS_PATH || './data/attachments'

/**
 * Check if subject indicates this is a reply/forward (has Re:, Fwd:, etc.)
 */
function isReplyOrForward(subject: string): boolean {
  return /^(re|fwd|fw|aw|sv|vs|ref)(\[\d+\])?:\s*/i.test(subject)
}

/**
 * Normalize subject for thread matching
 * Strips Re:, Fwd:, etc. prefixes
 */
function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(re|fwd|fw|aw|sv|vs|ref):\s*/gi, '')
    .replace(/^(re|fwd|fw|aw|sv|vs|ref)\[\d+\]:\s*/gi, '')
    .trim()
}

/**
 * Check if a name is just derived from the email's local part
 * e.g., "mecsagcal" from "mecsagcal@yahoo.com" - not a real name
 */
function isNameJustEmailLocalPart(name: string, email: string): boolean {
  const localPart = email.split('@')[0]?.toLowerCase()
  return localPart === name.toLowerCase()
}

/**
 * Clean and validate a contact name
 * Returns undefined if the name is not meaningful
 */
function cleanContactName(name: string | undefined, email: string): string | undefined {
  if (!name) return undefined
  // Strip surrounding quotes and trim
  let cleaned = name.trim().replace(/^["'](.*)["']$/, '$1').trim()
  if (!cleaned) return undefined
  // Treat name as undefined if it's just the email's local part
  if (isNameJustEmailLocalPart(cleaned, email)) return undefined
  return cleaned
}

/**
 * Find or create a contact by email
 * If fromJunkFolder is true and this is a NEW contact, set bucket to 'quarantine'
 */
function findOrCreateContact(email: string, name?: string, isMe: boolean = false, fromJunkFolder: boolean = false): number {
  // Clean the name before use
  const cleanedName = cleanContactName(name, email)

  const existing = db.select().from(contacts).where(eq(contacts.email, email)).get()

  if (existing) {
    // Update name if:
    // 1. We have a name and the existing doesn't, OR
    // 2. The existing name equals the email (placeholder) but we now have a real name
    const existingNameIsPlaceholder = existing.name === existing.email
    const shouldUpdateName = cleanedName && (!existing.name || existingNameIsPlaceholder)

    if (shouldUpdateName || (isMe && !existing.isMe)) {
      db.update(contacts)
        .set({
          name: shouldUpdateName ? cleanedName : existing.name,
          isMe: isMe || existing.isMe,
        })
        .where(eq(contacts.id, existing.id))
        .run()
    }
    return existing.id
  }

  // New contact - set bucket to quarantine if their first email is from Junk folder
  const bucket = (fromJunkFolder && !isMe) ? 'quarantine' : null
  const result = db.insert(contacts).values({ email, name: cleanedName, isMe, bucket }).returning({ id: contacts.id }).get()
  if (isMe) {
    console.log(`  Auto-created my contact: ${cleanedName || email} <${email}>`)
  } else if (bucket === 'quarantine') {
    console.log(`  Auto-quarantined contact from Junk folder: ${cleanedName || email} <${email}>`)
  }
  return result.id
}

/**
 * Find existing thread by message references or subject
 *
 * Threading strategy:
 * 1. Primary: Use In-Reply-To and References headers (reliable)
 * 2. Fallback A: Subject matching if email has Re:/Fwd: prefix
 * 3. Fallback B: Cross-party subject matching - if sender is me and thread
 *    creator is not me (or vice versa), they're probably conversing
 */
function findThread(
  messageId: string | undefined,
  inReplyTo: string | undefined,
  references: string[],
  normalizedSubject: string,
  isReply: boolean,
  senderIsMe: boolean
): number | null {
  // First, try to find by In-Reply-To or References (most reliable)
  const refIds = [inReplyTo, ...references].filter(Boolean) as string[]

  if (refIds.length > 0) {
    const existingEmail = db
      .select({ threadId: emails.threadId })
      .from(emails)
      .where(or(...refIds.map((ref) => eq(emails.messageId, ref))))
      .get()

    if (existingEmail) {
      return existingEmail.threadId
    }
  }

  // Fallback A: Subject matching if this looks like a reply/forward
  if (isReply) {
    const existingThread = db
      .select({ id: emailThreads.id })
      .from(emailThreads)
      .where(eq(emailThreads.subject, normalizedSubject))
      .get()

    if (existingThread) {
      return existingThread.id
    }
  }

  // Fallback B: Cross-party subject matching
  // If I'm sending and there's a thread with same subject from non-me, probably same convo
  // If someone else is sending and there's a thread with same subject from me, probably same convo
  const existingThread = db
    .select({ id: emailThreads.id, creatorIsMe: contacts.isMe })
    .from(emailThreads)
    .innerJoin(contacts, eq(contacts.id, emailThreads.creatorId))
    .where(eq(emailThreads.subject, normalizedSubject))
    .get()

  if (existingThread) {
    // Cross-party match: sender and creator are different parties (me vs not-me)
    if (senderIsMe !== existingThread.creatorIsMe) {
      return existingThread.id
    }
  }

  return null
}

/**
 * Create a new thread with creator
 */
function createThread(subject: string, creatorId: number): number {
  const result = db
    .insert(emailThreads)
    .values({ subject, creatorId })
    .returning({ id: emailThreads.id })
    .get()
  return result.id
}

/**
 * Update thread creator if this email is older than current first email
 */
function maybeUpdateThreadCreator(
  threadId: number,
  emailSentAt: Date | undefined,
  senderId: number
): void {
  // Get the current first email in the thread
  const firstEmail = db
    .select({ sentAt: emails.sentAt })
    .from(emails)
    .where(eq(emails.threadId, threadId))
    .orderBy(emails.sentAt)
    .limit(1)
    .get()

  // If no emails yet, or this email is older, update the creator
  if (!firstEmail || (emailSentAt && firstEmail.sentAt && emailSentAt < firstEmail.sentAt)) {
    db.update(emailThreads)
      .set({ creatorId: senderId })
      .where(eq(emailThreads.id, threadId))
      .run()
  }
}

/**
 * Save attachment to disk and create database record
 */
function saveAttachment(emailId: number, attachment: EmailAttachment): void {
  const filename = attachment.filename || `attachment_${Date.now()}`
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const filePath = join(ATTACHMENTS_DIR, `${emailId}_${safeFilename}`)

  // Ensure attachments directory exists
  if (!existsSync(ATTACHMENTS_DIR)) {
    mkdirSync(ATTACHMENTS_DIR, { recursive: true })
  }

  // Write file to disk
  if (attachment.content) {
    writeFileSync(filePath, attachment.content)
  }

  // TODO: Extract text from attachment for search
  // This would involve using libraries like pdf-parse, mammoth (docx), etc.
  const extractedText: string | null = null

  db.insert(attachments).values({
    emailId,
    filename,
    mimeType: attachment.contentType,
    size: attachment.size,
    filePath,
    contentId: attachment.contentId || null,
    isInline: attachment.isInline || false,
    extractedText,
  }).run()
}

/**
 * Import a single email from the common ImportableEmail format
 *
 * This function is source-agnostic - it doesn't know if the email
 * came from IMAP, mbox, EML files, or any other source.
 */
export async function importEmail(email: ImportableEmail): Promise<{ imported: boolean; reason?: string }> {
  const { messageId, subject, inReplyTo, references } = email

  // Skip if already imported
  if (messageId) {
    const existing = db.select({ id: emails.id }).from(emails).where(eq(emails.messageId, messageId)).get()
    if (existing) {
      return { imported: false, reason: 'duplicate' }
    }
  }

  const isReply = isReplyOrForward(subject)
  const normalizedSubject = normalizeSubject(subject)

  // For sent emails, mark "From" as our contact
  // For received emails, mark the deliveredTo address as our contact
  if (email.isSent) {
    if (email.from) {
      findOrCreateContact(email.from.email, email.from.name, true)
    }
  } else if (email.deliveredTo) {
    findOrCreateContact(email.deliveredTo, undefined, true)
  }

  // Get or create sender contact
  // Special case: Junk mail claiming to be "from me" is an impostor
  let senderId: number
  let senderIsMe = false

  if (email.from) {
    // Check if this is one of our addresses
    const existingMe = db.select().from(contacts)
      .where(eq(contacts.email, email.from.email))
      .get()

    // Junk mail claiming to be "from me" is an impostor - don't trust the From address
    if (email.isJunk && existingMe?.isMe) {
      senderId = findOrCreateContact('impostor@impostor', 'Impostor', false, true)
      senderIsMe = false
      console.log(`  Junk mail claiming to be from me (${email.from.email}) - attributed to Impostor`)
    } else {
      senderIsMe = existingMe?.isMe || email.isSent
      senderId = findOrCreateContact(email.from.email, email.from.name, senderIsMe, email.isJunk)
    }
  } else {
    // No from address - create unknown sender
    senderId = findOrCreateContact('unknown@unknown', 'Unknown Sender', false, email.isJunk)
  }

  // Find or create thread
  let threadId: number | null = findThread(messageId, inReplyTo, references, normalizedSubject, isReply, senderIsMe)
  const isNewThread = !threadId
  if (isNewThread) {
    threadId = createThread(normalizedSubject, senderId)
  } else {
    // Check if this email is older than the current first email - update creator if so
    maybeUpdateThreadCreator(threadId!, email.sentAt, senderId)
  }
  const finalThreadId = threadId!

  // Insert email
  // If already read, set readAt to receivedAt; otherwise leave null
  const receivedAt = new Date()
  const readAt = email.isRead ? receivedAt : null

  const emailResult = db
    .insert(emails)
    .values({
      threadId: finalThreadId,
      senderId,
      messageId,
      inReplyTo,
      references,
      folder: email.isSent ? 'sent' : email.isJunk ? 'junk' : 'inbox', // Normalized folder name
      readAt,
      subject,
      headers: email.headers,
      contentText: email.textContent,
      contentHtml: email.htmlContent || null,
      sentAt: email.sentAt,
      receivedAt,
    })
    .returning({ id: emails.id })
    .get()

  const emailId = emailResult.id

  // Link sender to email
  db.insert(emailContacts).values({ emailId, contactId: senderId, role: 'from' }).onConflictDoNothing().run()

  // Link sender to thread
  db.insert(emailThreadContacts).values({ threadId: finalThreadId, contactId: senderId, role: 'sender' }).onConflictDoNothing().run()

  // Process recipients
  const processRecipients = (addresses: EmailAddress[], role: 'to' | 'cc' | 'bcc') => {
    for (const addr of addresses) {
      // Check if this is one of our addresses
      const existingContact = db.select().from(contacts)
        .where(eq(contacts.email, addr.email))
        .get()
      const isMe = existingContact?.isMe || false

      // Auto-approve contacts that I send email TO (if not already bucketed)
      const shouldAutoApprove = email.isSent && !isMe && (!existingContact || existingContact.bucket === null)

      const contactId = findOrCreateContact(addr.email, addr.name, isMe)

      if (shouldAutoApprove) {
        db.update(contacts)
          .set({ bucket: 'approved' })
          .where(eq(contacts.id, contactId))
          .run()
        console.log(`  Auto-approved contact (I sent them email): ${addr.name || addr.email}`)
      }

      db.insert(emailContacts).values({ emailId, contactId, role }).onConflictDoNothing().run()
      db.insert(emailThreadContacts).values({ threadId: finalThreadId, contactId, role: 'recipient' }).onConflictDoNothing().run()
    }
  }

  processRecipients(email.to, 'to')
  processRecipients(email.cc, 'cc')
  processRecipients(email.bcc, 'bcc')

  // Save attachments
  for (const attachment of email.attachments) {
    saveAttachment(emailId, attachment)
  }

  return { imported: true }
}
