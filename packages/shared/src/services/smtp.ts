import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { randomUUID } from 'crypto'
import { config } from '../config'

export interface EmailRecipient {
  name?: string
  email: string
}

export interface SendableEmail {
  from: EmailRecipient
  to: EmailRecipient[]
  cc: EmailRecipient[]
  bcc: EmailRecipient[]
  subject: string
  text: string
  html?: string
  inReplyTo?: string
  references?: string[]
  attachments?: {
    filename: string
    path: string
    contentType?: string
    cid?: string
  }[]
}

let transporter: Transporter | null = null

/**
 * Get or create the SMTP transporter
 */
export function getSmtpTransporter(): Transporter {
  if (!transporter) {
    if (!config.smtp.host) {
      throw new Error('SMTP not configured: SMTP_HOST is missing')
    }
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    })
  }
  return transporter
}

/**
 * Format an email address with optional name
 */
function formatAddress(recipient: EmailRecipient): string {
  if (recipient.name) {
    // Escape double quotes in the name
    const escapedName = recipient.name.replace(/"/g, '\\"')
    return `"${escapedName}" <${recipient.email}>`
  }
  return recipient.email
}

/**
 * Generate an RFC 5322 compliant Message-ID
 */
export function generateMessageId(): string {
  const randomPart = randomUUID().replace(/-/g, '')
  // Use the SMTP user's domain or fallback
  const domain = config.smtp.user?.split('@')[1] || 'meremail.local'
  return `<${randomPart}@${domain}>`
}

/**
 * Send an email via SMTP
 * Returns the message ID assigned by the server (or the one we generated)
 */
export async function sendEmail(email: SendableEmail): Promise<{ messageId: string }> {
  const transport = getSmtpTransporter()
  const messageId = generateMessageId()

  const result = await transport.sendMail({
    messageId,
    from: formatAddress(email.from),
    to: email.to.map(formatAddress),
    cc: email.cc.length > 0 ? email.cc.map(formatAddress) : undefined,
    bcc: email.bcc.length > 0 ? email.bcc.map(formatAddress) : undefined,
    subject: email.subject,
    text: email.text,
    html: email.html,
    inReplyTo: email.inReplyTo,
    references: email.references?.join(' '),
    attachments: email.attachments?.map(att => ({
      filename: att.filename,
      path: att.path,
      contentType: att.contentType,
      cid: att.cid,
    })),
  })

  // nodemailer returns the message ID without angle brackets, but we store with them
  return { messageId: result.messageId || messageId }
}
