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
 * Check if folder is a Junk/Spam folder
 */
function isJunkFolder(folder: string): boolean {
  return /^(junk|spam|\[gmail\]\/spam)$/i.test(folder)
}

/**
 * Find or create a contact by email
 * If fromJunkFolder is true and this is a NEW contact, set bucket to 'quarantine'
 */
function findOrCreateContact(email: string, name?: string, isMe: boolean = false, fromJunkFolder: boolean = false): number {
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

  // New contact - set bucket to quarantine if their first email is from Junk folder
  const bucket = (fromJunkFolder && !isMe) ? 'quarantine' : null
  const result = db.insert(contacts).values({ email, name, isMe, bucket }).returning({ id: contacts.id }).get()
  if (isMe) {
    console.log(`  Auto-created my contact: ${name || email} <${email}>`)
  } else if (bucket === 'quarantine') {
    console.log(`  Auto-quarantined contact from Junk folder: ${name || email} <${email}>`)
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
  const { parsed, folder, flags } = fetched
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

  // Process From address - this is the sender
  const fromAddr = parsed.from?.value?.[0]
  const fromParsed = parseEmailAddress(fromAddr)

  // Determine if this is a "sent" folder (where we are the sender)
  const isSentFolder = /^(sent|sent items|sent mail|\[gmail\]\/sent mail)$/i.test(folder)

  // Check if this is from a Junk/Spam folder - auto-quarantine new contacts
  const fromJunk = isJunkFolder(folder)

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
  // If from Junk folder and new contact, auto-quarantine them
  // EXCEPTION: Junk mail "from me" is NOT actually me - it's an impostor
  let senderId: number
  let senderIsMe = false
  if (fromParsed) {
    // Check if this is one of our addresses
    const existingMe = db.select().from(contacts)
      .where(eq(contacts.email, fromParsed.email))
      .get()

    // Junk mail claiming to be "from me" is an impostor - don't trust the From address
    if (fromJunk && existingMe?.isMe) {
      // Create/find an "Impostor" contact for this spoofed email
      senderId = findOrCreateContact('impostor@impostor', 'Impostor', false, true)
      senderIsMe = false
      console.log(`  Junk mail claiming to be from me (${fromParsed.email}) - attributed to Impostor`)
    } else {
      senderIsMe = existingMe?.isMe || isSentFolder
      senderId = findOrCreateContact(fromParsed.email, fromParsed.name, senderIsMe, fromJunk)
    }
  } else {
    // No from address - create unknown sender
    senderId = findOrCreateContact('unknown@unknown', 'Unknown Sender', false, fromJunk)
  }

  // Find or create thread
  let threadId = findThread(messageId, inReplyTo, references, normalizedSubject, isReply, senderIsMe)
  const isNewThread = !threadId
  if (isNewThread) {
    threadId = createThread(normalizedSubject, senderId)
  } else {
    // Check if this email is older than the current first email - update creator if so
    maybeUpdateThreadCreator(threadId, parsed.date, senderId)
  }

  // Get email content - store both text and HTML
  const contentText = parsed.text || ''
  const contentHtml = parsed.html || null

  // Insert email
  // Use IMAP \Seen flag for read state, or mark as read if from sent folder
  const isRead = flags.has('\\Seen') || isSentFolder

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
        const existingContact = db.select().from(contacts)
          .where(eq(contacts.email, addrParsed.email))
          .get()
        const isMe = existingContact?.isMe || false

        // Auto-approve contacts that I send email TO (if not already bucketed)
        // This means if I've emailed someone, they're implicitly approved
        const shouldAutoApprove = isSentFolder && !isMe && (!existingContact || existingContact.bucket === null)

        const contactId = findOrCreateContact(addrParsed.email, addrParsed.name, isMe)

        if (shouldAutoApprove) {
          db.update(contacts)
            .set({ bucket: 'approved' })
            .where(eq(contacts.id, contactId))
            .run()
          console.log(`  Auto-approved contact (I sent them email): ${addrParsed.name || addrParsed.email}`)
        }

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
