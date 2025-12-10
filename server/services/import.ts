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
import type { FetchedEmail } from './imap'

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
 * Parse email address from string like "Name <email@example.com>" or just "email@example.com"
 */
function parseEmailAddress(addr: { address?: string; name?: string } | string | undefined): {
  email: string
  name: string | undefined
} | null {
  if (!addr) return null

  if (typeof addr === 'string') {
    const match = addr.match(/<([^>]+)>/)
    if (match) {
      const rawName = addr.replace(/<[^>]+>/, '').trim() || undefined
      const email = match[1].toLowerCase()
      // Treat name as undefined if it's just the email's local part
      const name = rawName && isNameJustEmailLocalPart(rawName, email) ? undefined : rawName
      return { email, name }
    }
    return { email: addr.toLowerCase(), name: undefined }
  }

  if (!addr.address) return null
  const email = addr.address.toLowerCase()
  const rawName = addr.name || undefined
  // Treat name as undefined if it's just the email's local part
  const name = rawName && isNameJustEmailLocalPart(rawName, email) ? undefined : rawName
  return { email, name }
}

/**
 * Find or create a contact by email
 */
function findOrCreateContact(email: string, name?: string, isMe: boolean = false): number {
  const existing = db.select().from(contacts).where(eq(contacts.email, email)).get()

  if (existing) {
    // Update name if:
    // 1. We have a name and the existing doesn't, OR
    // 2. The existing name equals the email (placeholder) but we now have a real name
    const existingNameIsPlaceholder = existing.name === existing.email
    const shouldUpdateName = name && (!existing.name || existingNameIsPlaceholder)

    if (shouldUpdateName || (isMe && !existing.isMe)) {
      db.update(contacts)
        .set({
          name: shouldUpdateName ? name : existing.name,
          isMe: isMe || existing.isMe,
        })
        .where(eq(contacts.id, existing.id))
        .run()
    }
    return existing.id
  }

  const result = db.insert(contacts).values({ email, name, isMe }).returning({ id: contacts.id }).get()
  if (isMe) {
    console.log(`  Auto-created my contact: ${name || email} <${email}>`)
  }
  return result.id
}

/**
 * Find existing thread by message references or subject
 *
 * Threading strategy:
 * 1. Primary: Use In-Reply-To and References headers (reliable)
 * 2. Fallback: Only use subject matching if the email looks like a reply
 *    (has Re:/Fwd: prefix). This avoids grouping unrelated transactional
 *    emails like "Please verify your email" or payment notifications.
 */
function findThread(
  messageId: string | undefined,
  inReplyTo: string | undefined,
  references: string[],
  normalizedSubject: string,
  isReply: boolean
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

  // Only fall back to subject matching if this looks like a reply/forward
  // This prevents grouping unrelated emails with generic subjects
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

  return null
}

/**
 * Create a new thread
 */
function createThread(subject: string): number {
  const result = db
    .insert(emailThreads)
    .values({ subject })
    .returning({ id: emailThreads.id })
    .get()
  return result.id
}

/**
 * Save attachment to disk and create database record
 */
function saveAttachment(
  emailId: number,
  attachment: {
    filename?: string
    contentType?: string
    size?: number
    content?: Buffer
    cid?: string  // Content-ID for inline images
    contentDisposition?: string
  }
): void {
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

  // Determine if this is an inline attachment (embedded in HTML)
  const isInline = !!attachment.cid || attachment.contentDisposition === 'inline'

  // TODO: Extract text from attachment for search
  // This would involve using libraries like pdf-parse, mammoth (docx), etc.
  const extractedText: string | null = null

  db.insert(attachments).values({
    emailId,
    filename,
    mimeType: attachment.contentType,
    size: attachment.size,
    filePath,
    contentId: attachment.cid || null,
    isInline,
    extractedText,
  }).run()
}

/**
 * Import a single email
 */
export async function importEmail(fetched: FetchedEmail): Promise<{ imported: boolean; reason?: string }> {
  const { parsed, folder } = fetched
  const messageId = parsed.messageId

  // Skip if already imported
  if (messageId) {
    const existing = db.select({ id: emails.id }).from(emails).where(eq(emails.messageId, messageId)).get()
    if (existing) {
      return { imported: false, reason: 'duplicate' }
    }
  }

  const subject = parsed.subject || '(no subject)'
  const isReply = isReplyOrForward(subject)
  const normalizedSubject = normalizeSubject(subject)
  const inReplyTo = parsed.inReplyTo
  const references = Array.isArray(parsed.references)
    ? parsed.references
    : parsed.references
      ? [parsed.references]
      : []

  // Find or create thread
  let threadId = findThread(messageId, inReplyTo, references, normalizedSubject, isReply)
  if (!threadId) {
    threadId = createThread(normalizedSubject)
  }

  // Process From address - this is the sender
  const fromAddr = parsed.from?.value?.[0]
  const fromParsed = parseEmailAddress(fromAddr)

  // Determine if this is a "sent" folder (where we are the sender)
  const isSentFolder = /^(sent|sent items|sent mail|\[gmail\]\/sent mail)$/i.test(folder)

  // For received emails: use "Delivered-To" header to find our address
  // For sent emails: "From" is our address
  if (isSentFolder) {
    // We sent this email - mark "From" as our contact
    if (fromParsed) {
      findOrCreateContact(fromParsed.email, fromParsed.name, true)
    }
  } else {
    // We received this email - "Delivered-To" header tells us which address received it
    const deliveredTo = parsed.headers?.get('delivered-to') as { value?: { address?: string; name?: string }[] } | undefined
    const deliveredToAddr = deliveredTo?.value?.[0]
    if (deliveredToAddr) {
      const deliveredToParsed = parseEmailAddress(deliveredToAddr)
      if (deliveredToParsed) {
        findOrCreateContact(deliveredToParsed.email, deliveredToParsed.name, true)
      }
    }
  }

  // Get or create sender contact (always create, whether it's us or someone else)
  let senderId: number
  if (fromParsed) {
    // Check if this is one of our addresses
    const existingMe = db.select().from(contacts)
      .where(eq(contacts.email, fromParsed.email))
      .get()
    const isMe = existingMe?.isMe || isSentFolder
    senderId = findOrCreateContact(fromParsed.email, fromParsed.name, isMe)
  } else {
    // No from address - create unknown sender
    senderId = findOrCreateContact('unknown@unknown', 'Unknown Sender', false)
  }

  // Get email content - store both text and HTML
  const contentText = parsed.text || ''
  const contentHtml = parsed.html || null

  // Insert email
  // Sent emails are automatically marked as read
  const isRead = isSentFolder

  const emailResult = db
    .insert(emails)
    .values({
      threadId,
      senderId,
      messageId,
      inReplyTo,
      references,
      folder,
      isRead,
      subject,
      headers: parsed.headers ? Object.fromEntries(
        Array.from(parsed.headers.entries()).map(([k, v]) => [
          k,
          typeof v === 'object' ? JSON.stringify(v) : String(v)
        ])
      ) : {},
      contentText,
      contentHtml,
      sentAt: parsed.date,
      receivedAt: new Date(),
    })
    .returning({ id: emails.id })
    .get()

  const emailId = emailResult.id

  // Link sender to email
  db.insert(emailContacts).values({ emailId, contactId: senderId, role: 'from' }).onConflictDoNothing().run()

  // Link sender to thread
  db.insert(emailThreadContacts).values({ threadId, contactId: senderId, role: 'sender' }).onConflictDoNothing().run()

  // Create contacts for recipients and link to email
  // Helper to extract addresses from AddressObject | AddressObject[] | undefined
  type AddressList = { address?: string; name?: string }[]
  const getAddresses = (field: typeof parsed.to): AddressList => {
    if (!field) return []
    if (Array.isArray(field)) {
      return field.flatMap(f => f.value || [])
    }
    return field.value || []
  }

  const recipientTypes: Array<{ addrs: AddressList; role: 'to' | 'cc' | 'bcc' }> = [
    { addrs: getAddresses(parsed.to), role: 'to' },
    { addrs: getAddresses(parsed.cc), role: 'cc' },
    { addrs: getAddresses(parsed.bcc), role: 'bcc' },
  ]

  for (const { addrs, role } of recipientTypes) {
    for (const addr of addrs) {
      const addrParsed = parseEmailAddress(addr)
      if (addrParsed) {
        // Check if this is one of our addresses
        const existingMe = db.select().from(contacts)
          .where(eq(contacts.email, addrParsed.email))
          .get()
        const isMe = existingMe?.isMe || false

        const contactId = findOrCreateContact(addrParsed.email, addrParsed.name, isMe)
        db.insert(emailContacts).values({ emailId, contactId, role }).onConflictDoNothing().run()

        // Also link to thread as recipient
        db.insert(emailThreadContacts).values({ threadId, contactId, role: 'recipient' }).onConflictDoNothing().run()
      }
    }
  }

  // Save attachments
  if (parsed.attachments && parsed.attachments.length > 0) {
    for (const attachment of parsed.attachments) {
      saveAttachment(emailId, attachment)
    }
  }

  return { imported: true }
}
