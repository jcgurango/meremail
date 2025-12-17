/**
 * Common email data transfer types
 *
 * These types represent a normalized email structure that any source
 * (IMAP, mbox, EML files, API, etc.) can produce. The import service
 * consumes this common format without knowing about the source.
 */

/**
 * A parsed email address with optional display name
 */
export interface EmailAddress {
  email: string
  name?: string
}

/**
 * An email attachment
 */
export interface EmailAttachment {
  filename?: string
  contentType?: string
  size?: number
  content?: Buffer
  contentId?: string // CID for inline images (e.g., "image001.png")
  isInline?: boolean // true if embedded in HTML body
}

/**
 * Source-agnostic email data transfer object
 *
 * This is the common format that all email sources should produce.
 * It contains everything needed to import an email without any
 * source-specific details (no IMAP UIDs, no folder paths, etc.)
 */
export interface ImportableEmail {
  // === Identity ===
  /** RFC 5322 Message-ID header */
  messageId?: string

  // === Threading ===
  /** RFC 5322 In-Reply-To header */
  inReplyTo?: string
  /** RFC 5322 References header (list of message IDs) */
  references: string[]

  // === Addresses ===
  /** From address (sender) */
  from?: EmailAddress
  /** To recipients */
  to: EmailAddress[]
  /** CC recipients */
  cc: EmailAddress[]
  /** BCC recipients (usually only available for sent mail) */
  bcc: EmailAddress[]
  /**
   * The address this email was delivered to (i.e., "me")
   * Used to auto-detect which contacts are the user's own addresses.
   * For IMAP this comes from Delivered-To or provider-specific headers.
   */
  deliveredTo?: string

  // === Content ===
  /** Email subject (normalized, e.g., "(no subject)" if empty) */
  subject: string
  /** Plain text body */
  textContent: string
  /** HTML body (if available) */
  htmlContent?: string

  // === Metadata ===
  /** When the email was sent (Date header) */
  sentAt?: Date
  /** Whether the email has been read */
  isRead: boolean
  /**
   * Whether this email was sent BY the user (from sent folder or equivalent).
   * Used for:
   * - Marking From address as "me"
   * - Auto-approving To recipients as known contacts
   */
  isSent: boolean
  /**
   * Whether this email came from a junk/spam folder.
   * Used for:
   * - Auto-quarantining new contacts from spam
   * - Detecting "impostor" emails that spoof the user's address
   */
  isJunk: boolean

  // === Attachments ===
  attachments: EmailAttachment[]

  // === Raw headers ===
  /**
   * All headers as key-value pairs for anything else needed.
   * Values are stringified (complex objects should be JSON).
   */
  headers: { key: string, value: string }[]
}
