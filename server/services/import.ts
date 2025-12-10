import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { eq, or, inArray } from 'drizzle-orm'
import { db } from '../db'
import {
  emails,
  emailThreads,
  contacts,
  emailContacts,
  emailThreadContacts,
  senderAddresses,
  attachments,
} from '../db/schema'
import type { FetchedEmail } from './imap'

const ATTACHMENTS_DIR = process.env.ATTACHMENTS_PATH || './data/attachments'

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
      const name = addr.replace(/<[^>]+>/, '').trim() || undefined
      return { email: match[1].toLowerCase(), name }
    }
    return { email: addr.toLowerCase(), name: undefined }
  }

  if (!addr.address) return null
  return { email: addr.address.toLowerCase(), name: addr.name || undefined }
}

/**
 * Find or create a contact by email
 */
async function findOrCreateContact(email: string, name?: string): Promise<number> {
  const existing = db.select().from(contacts).where(eq(contacts.email, email)).get()

  if (existing) {
    // Update name if we have one and the existing doesn't
    if (name && !existing.name) {
      db.update(contacts).set({ name }).where(eq(contacts.id, existing.id)).run()
    }
    return existing.id
  }

  const result = db.insert(contacts).values({ email, name }).returning({ id: contacts.id }).get()
  return result.id
}

/**
 * Check if an email address is one of our sender addresses
 */
async function isSenderAddress(email: string): Promise<boolean> {
  const existing = db.select().from(senderAddresses).where(eq(senderAddresses.email, email)).get()
  return !!existing
}

/**
 * Auto-create sender address if we received email to an unknown address
 */
async function ensureSenderAddress(email: string, name?: string): Promise<void> {
  const existing = db.select().from(senderAddresses).where(eq(senderAddresses.email, email)).get()
  if (!existing) {
    db.insert(senderAddresses).values({ email, name: name || email }).run()
    console.log(`  Auto-created sender address: ${name || email} <${email}>`)
  }
}

/**
 * Find existing thread by message references or subject
 */
async function findThread(
  messageId: string | undefined,
  inReplyTo: string | undefined,
  references: string[],
  normalizedSubject: string
): Promise<number | null> {
  // First, try to find by In-Reply-To or References
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

  // Fall back to subject matching for threads
  const existingThread = db
    .select({ id: emailThreads.id })
    .from(emailThreads)
    .where(eq(emailThreads.subject, normalizedSubject))
    .get()

  return existingThread?.id ?? null
}

/**
 * Create a new thread
 */
async function createThread(subject: string): Promise<number> {
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
async function saveAttachment(
  emailId: number,
  attachment: {
    filename?: string
    contentType?: string
    size?: number
    content?: Buffer
  }
): Promise<void> {
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
  const normalizedSubject = normalizeSubject(subject)
  const inReplyTo = parsed.inReplyTo
  const references = Array.isArray(parsed.references)
    ? parsed.references
    : parsed.references
      ? [parsed.references]
      : []

  // Find or create thread
  let threadId = await findThread(messageId, inReplyTo, references, normalizedSubject)
  if (!threadId) {
    threadId = await createThread(normalizedSubject)
  }

  // Process From address
  const fromAddr = parsed.from?.value?.[0]
  const fromParsed = parseEmailAddress(fromAddr)

  // Determine if this is a "sent" folder (where we are the sender)
  const isSentFolder = /^(sent|sent items|sent mail|\[gmail\]\/sent mail)$/i.test(folder)

  // For received emails: use "Delivered-To" header to find our address
  // For sent emails: "From" is our address
  if (isSentFolder) {
    // We sent this email - ensure our "From" address is a sender address
    if (fromParsed) {
      await ensureSenderAddress(fromParsed.email, fromParsed.name)
    }
  } else {
    // We received this email - "Delivered-To" header tells us which address received it
    const deliveredTo = parsed.headers?.get('delivered-to') as { value?: { address?: string; name?: string }[] } | undefined
    const deliveredToAddr = deliveredTo?.value?.[0]
    if (deliveredToAddr) {
      const deliveredToParsed = parseEmailAddress(deliveredToAddr)
      if (deliveredToParsed) {
        await ensureSenderAddress(deliveredToParsed.email, deliveredToParsed.name)
      }
    }
  }

  // Get email content (prefer text, fall back to html)
  const content = parsed.text || parsed.html || ''

  // Insert email
  const emailResult = db
    .insert(emails)
    .values({
      threadId,
      messageId,
      inReplyTo,
      references,
      folder,
      subject,
      headers: parsed.headers ? Object.fromEntries(parsed.headers) : {},
      content,
      sentAt: parsed.date,
      receivedAt: new Date(),
    })
    .returning({ id: emails.id })
    .get()

  const emailId = emailResult.id

  // Create contact for sender and link to email
  if (fromParsed) {
    const isSender = await isSenderAddress(fromParsed.email)
    if (!isSender) {
      const contactId = await findOrCreateContact(fromParsed.email, fromParsed.name)
      db.insert(emailContacts).values({ emailId, contactId, role: 'from' }).run()

      // Also link to thread
      const existingThreadContact = db
        .select()
        .from(emailThreadContacts)
        .where(eq(emailThreadContacts.threadId, threadId))
        .where(eq(emailThreadContacts.contactId, contactId))
        .where(eq(emailThreadContacts.role, 'sender'))
        .get()

      if (!existingThreadContact) {
        db.insert(emailThreadContacts).values({ threadId, contactId, role: 'sender' }).run()
      }
    }
  }

  // Create contacts for recipients and link to email
  type AddressList = { address?: string; name?: string }[]
  const recipientTypes: Array<{ addrs: AddressList; role: 'to' | 'cc' | 'bcc' }> = [
    { addrs: parsed.to?.value || [], role: 'to' },
    { addrs: parsed.cc?.value || [], role: 'cc' },
    { addrs: parsed.bcc?.value || [], role: 'bcc' },
  ]

  for (const { addrs, role } of recipientTypes) {
    for (const addr of addrs) {
      const addrParsed = parseEmailAddress(addr)
      if (addrParsed) {
        const isSender = await isSenderAddress(addrParsed.email)
        if (!isSender) {
          const contactId = await findOrCreateContact(addrParsed.email, addrParsed.name)
          db.insert(emailContacts).values({ emailId, contactId, role }).run()

          // Also link to thread as recipient
          const existingThreadContact = db
            .select()
            .from(emailThreadContacts)
            .where(eq(emailThreadContacts.threadId, threadId))
            .where(eq(emailThreadContacts.contactId, contactId))
            .where(eq(emailThreadContacts.role, 'recipient'))
            .get()

          if (!existingThreadContact) {
            db.insert(emailThreadContacts).values({ threadId, contactId, role: 'recipient' }).run()
          }
        }
      }
    }
  }

  // Save attachments
  if (parsed.attachments && parsed.attachments.length > 0) {
    for (const attachment of parsed.attachments) {
      await saveAttachment(emailId, attachment)
    }
  }

  return { imported: true }
}
