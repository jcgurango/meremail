import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { ImapFlow } from 'imapflow'
import { simpleParser, ParsedMail } from 'mailparser'
import { config } from '../config'
import type { ImportableEmail, EmailAddress, EmailAttachment } from '../types/email'

export interface FetchedEmail {
  uid: number
  folder: string
  parsed: ParsedMail
  raw: Buffer
  flags: Set<string>
}

/**
 * Check if folder is a Sent folder
 */
function isSentFolder(folder: string): boolean {
  return /^(sent|sent items|sent mail|\[gmail\]\/sent mail)$/i.test(folder)
}

/**
 * Check if folder is a Junk/Spam folder
 */
function isJunkFolder(folder: string): boolean {
  return /^(junk|spam|\[gmail\]\/spam)$/i.test(folder)
}

/**
 * Parse an address object from mailparser into our common format
 */
function parseAddress(addr: { address?: string; name?: string } | undefined): EmailAddress | undefined {
  if (!addr?.address) return undefined
  return {
    email: addr.address.toLowerCase(),
    name: addr.name?.trim() || undefined,
  }
}

/**
 * Parse address list from mailparser's AddressObject format
 */
function parseAddressList(field: ParsedMail['to']): EmailAddress[] {
  if (!field) return []
  const values = Array.isArray(field) ? field.flatMap((f) => f.value || []) : field.value || []
  return values.map(parseAddress).filter((a): a is EmailAddress => a !== undefined)
}

/**
 * Extract the "delivered to" address from headers
 * Priority: X-PM-Original-To (Purelymail alias), X-PM-Known-Alias, Delivered-To
 */
function extractDeliveredTo(headers: ParsedMail['headers']): string | undefined {
  if (!headers) return undefined

  // Check Purelymail-specific headers for alias detection
  const xPmOriginalTo = headers.get('x-pm-original-to') as string | undefined
  if (xPmOriginalTo && typeof xPmOriginalTo === 'string') {
    return xPmOriginalTo.toLowerCase().trim()
  }

  const xPmKnownAlias = headers.get('x-pm-known-alias') as string | undefined
  if (xPmKnownAlias && typeof xPmKnownAlias === 'string') {
    return xPmKnownAlias.toLowerCase().trim()
  }

  // Fall back to Delivered-To header
  const deliveredTo = headers.get('delivered-to') as { value?: { address?: string }[] } | undefined
  const deliveredToAddr = deliveredTo?.value?.[0]
  if (deliveredToAddr?.address) {
    return deliveredToAddr.address.toLowerCase()
  }

  return undefined
}

/**
 * Convert mailparser attachment to our common format
 */
function convertAttachment(att: ParsedMail['attachments'][number]): EmailAttachment {
  return {
    filename: att.filename,
    contentType: att.contentType,
    size: att.size,
    content: att.content,
    contentId: att.cid,
    isInline: !!att.cid || att.contentDisposition === 'inline',
  }
}

/**
 * Stringify headers map to key-value record
 */
function stringifyHeaders(headers: ParsedMail['headers']): Record<string, string> {
  if (!headers) return {}
  return Object.fromEntries(
    Array.from(headers.entries()).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])
  )
}

/**
 * Convert IMAP FetchedEmail to source-agnostic ImportableEmail
 */
export function toImportableEmail(fetched: FetchedEmail): ImportableEmail {
  const { parsed, folder, flags } = fetched

  // Parse references - can be string or string[]
  const references = Array.isArray(parsed.references)
    ? parsed.references
    : parsed.references
      ? [parsed.references]
      : []

  return {
    // Identity
    messageId: parsed.messageId,

    // Threading
    inReplyTo: parsed.inReplyTo,
    references,

    // Addresses
    from: parseAddress(parsed.from?.value?.[0]),
    to: parseAddressList(parsed.to),
    cc: parseAddressList(parsed.cc),
    bcc: parseAddressList(parsed.bcc),
    deliveredTo: extractDeliveredTo(parsed.headers),

    // Content
    subject: parsed.subject || '(no subject)',
    textContent: parsed.text || '',
    htmlContent: parsed.html || undefined,

    // Metadata
    sentAt: parsed.date,
    isRead: flags.has('\\Seen') || isSentFolder(folder),
    isSent: isSentFolder(folder),
    isJunk: isJunkFolder(folder),

    // Attachments
    attachments: (parsed.attachments || []).map(convertAttachment),

    // Headers
    headers: stringifyHeaders(parsed.headers),
  }
}

export async function createImapClient(): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: {
      user: config.imap.user,
      pass: config.imap.pass,
    },
    logger: false,
  })

  await client.connect()
  return client
}

export async function* fetchEmails(
  client: ImapFlow,
  folder: string,
  since?: Date
): AsyncGenerator<FetchedEmail> {
  const lock = await client.getMailboxLock(folder)

  try {
    const searchCriteria: any = { all: true }
    if (since) {
      searchCriteria.since = since
    }

    const messages = client.fetch(searchCriteria, {
      uid: true,
      envelope: true,
      source: true,
      flags: true,
    })

    for await (const message of messages) {
      const raw = message.source
      if (!raw) continue
      // skipImageLinks: don't auto-convert cid: references to data URIs
      const parsed = await simpleParser(raw, { skipImageLinks: true })

      yield {
        uid: message.uid,
        folder,
        parsed,
        raw,
        flags: message.flags ?? new Set<string>(),
      }
    }
  } finally {
    lock.release()
  }
}

export async function listFolders(client: ImapFlow): Promise<string[]> {
  const folders = await client.list()
  return folders.map((f) => f.path)
}

/**
 * Sanitize a string for use as a filename
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').substring(0, 200)
}

/**
 * Backup a raw EML file to the backup directory
 * Organizes by folder: eml-backup/INBOX/message-id.eml
 *
 * Prepends X-IMAP-* headers to preserve IMAP metadata:
 * - X-IMAP-Folder: The folder this email was retrieved from
 * - X-IMAP-Flags: IMAP flags (\Seen, \Flagged, etc.)
 * - X-IMAP-Uid: IMAP UID for this message
 *
 * @returns The path where the file was saved, or null if backup is disabled
 */
export function backupEml(fetched: FetchedEmail): string | null {
  if (!config.emlBackup.enabled) {
    return null
  }

  const backupDir = config.emlBackup.path
  const folderDir = join(backupDir, sanitizeFilename(fetched.folder))

  // Ensure directory exists
  if (!existsSync(folderDir)) {
    mkdirSync(folderDir, { recursive: true })
  }

  // Use message-id as filename if available, otherwise UID
  const messageId = fetched.parsed.messageId
  const filename = messageId
    ? `${sanitizeFilename(messageId)}.eml`
    : `uid-${fetched.uid}.eml`

  const filePath = join(folderDir, filename)

  // Skip if already backed up
  if (existsSync(filePath)) {
    return filePath
  }

  // Prepend X-IMAP-* headers to preserve metadata not in the original EML
  const imapHeaders = [
    `X-IMAP-Folder: ${fetched.folder}`,
    `X-IMAP-Uid: ${fetched.uid}`,
    `X-IMAP-Flags: ${Array.from(fetched.flags).join(' ') || '(none)'}`,
  ].join('\r\n') + '\r\n'

  const emlWithMetadata = Buffer.concat([
    Buffer.from(imapHeaders),
    fetched.raw,
  ])

  writeFileSync(filePath, emlWithMetadata)
  return filePath
}
