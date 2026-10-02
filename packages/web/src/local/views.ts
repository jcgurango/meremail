import type { SyncParticipant } from '@meremail/shared/sync-types'
import type { LocalEmail } from './db'
import { renderEmailContent } from './render'

/**
 * An email as the message component wants it
 */
export interface EmailView {
  id: number
  threadId: number
  subject: string
  /** HTML to display (not yet sanitised) */
  content: string
  contentText: string
  contentHtml: string | null
  sentAt: number | null
  receivedAt: number | null
  isRead: boolean
  status: 'queued' | 'sent'
  sender: SyncParticipant | null
  recipients: SyncParticipant[]
  /** Attachments to list - inline images are shown in the body instead */
  attachments: { id: number; filename: string; mimeType: string | null; size: number | null; isInline: boolean }[]
  replyTo: string | null
  messageId: string | null
  references: string[]
  inReplyTo: string | null
  queuedAt: number | null
  lastSendError: string | null
}

export function toEmailView(email: LocalEmail, imageProxyUrl: string): EmailView {
  return {
    id: email.id,
    threadId: email.threadId,
    subject: email.subject,
    content: renderEmailContent(email, imageProxyUrl),
    contentText: email.contentText,
    contentHtml: email.contentHtml,
    sentAt: email.sentAt,
    receivedAt: email.receivedAt,
    isRead: !email.unread,
    status: email.status,
    sender: email.sender,
    recipients: email.recipients,
    attachments: email.attachments.filter(a => !a.isInline),
    replyTo: email.replyTo,
    messageId: email.messageId,
    references: email.references,
    inReplyTo: email.inReplyTo,
    queuedAt: email.queuedAt,
    lastSendError: email.lastSendError,
  }
}
