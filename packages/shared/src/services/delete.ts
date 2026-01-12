import { eq, inArray, sql } from 'drizzle-orm'
import { unlinkSync, existsSync } from 'fs'
import { db } from '../db'
import { resolveAttachmentPath } from '../config'
import {
  emails,
  emailThreads,
  contacts,
  emailContacts,
  emailThreadContacts,
  attachments,
} from '../db/schema'

/**
 * Delete attachment files from disk for given attachment IDs
 */
function deleteAttachmentFiles(attachmentIds: number[]): { deleted: number; errors: number } {
  let deleted = 0
  let errors = 0

  for (const id of attachmentIds) {
    const attachment = db
      .select({ filePath: attachments.filePath })
      .from(attachments)
      .where(eq(attachments.id, id))
      .get()

    if (attachment?.filePath) {
      const resolvedPath = resolveAttachmentPath(attachment.filePath)
      if (existsSync(resolvedPath)) {
        try {
          unlinkSync(resolvedPath)
          deleted++
        } catch (e) {
          console.error(`Failed to delete file ${resolvedPath}:`, e)
          errors++
        }
      }
    }
  }

  return { deleted, errors }
}

/**
 * Delete a single email and all its associated data
 * - Deletes attachment files from disk
 * - Deletes attachment records
 * - Deletes email_contacts junction records
 * - Deletes the email record
 *
 * Note: Does NOT delete the parent thread or update email_thread_contacts
 * Use deleteThread() or cleanupEmptyThreads() for that
 */
export function deleteEmail(emailId: number): { success: boolean; attachmentsDeleted: number } {
  // Get attachment IDs for this email
  const emailAttachments = db
    .select({ id: attachments.id })
    .from(attachments)
    .where(eq(attachments.emailId, emailId))
    .all()

  const attachmentIds = emailAttachments.map(a => a.id)

  // Delete attachment files from disk
  const fileResult = deleteAttachmentFiles(attachmentIds)

  // Delete attachment records
  if (attachmentIds.length > 0) {
    db.delete(attachments).where(inArray(attachments.id, attachmentIds)).run()
  }

  // Delete email_contacts junction records
  db.delete(emailContacts).where(eq(emailContacts.emailId, emailId)).run()

  // Delete the email
  db.delete(emails).where(eq(emails.id, emailId)).run()

  return { success: true, attachmentsDeleted: fileResult.deleted }
}

/**
 * Delete multiple emails efficiently
 */
export function deleteEmails(emailIds: number[]): { emailsDeleted: number; attachmentsDeleted: number } {
  if (emailIds.length === 0) return { emailsDeleted: 0, attachmentsDeleted: 0 }

  // Get all attachment IDs for these emails
  const emailAttachments = db
    .select({ id: attachments.id })
    .from(attachments)
    .where(inArray(attachments.emailId, emailIds))
    .all()

  const attachmentIds = emailAttachments.map(a => a.id)

  // Delete attachment files from disk
  const fileResult = deleteAttachmentFiles(attachmentIds)

  // Delete attachment records
  if (attachmentIds.length > 0) {
    db.delete(attachments).where(inArray(attachments.id, attachmentIds)).run()
  }

  // Delete email_contacts junction records
  db.delete(emailContacts).where(inArray(emailContacts.emailId, emailIds)).run()

  // Delete the emails
  db.delete(emails).where(inArray(emails.id, emailIds)).run()

  return { emailsDeleted: emailIds.length, attachmentsDeleted: fileResult.deleted }
}

/**
 * Delete a thread and all its emails
 */
export function deleteThread(threadId: number): { success: boolean; emailsDeleted: number; attachmentsDeleted: number } {
  // Get all email IDs in this thread
  const threadEmails = db
    .select({ id: emails.id })
    .from(emails)
    .where(eq(emails.threadId, threadId))
    .all()

  const emailIds = threadEmails.map(e => e.id)

  // Delete all emails (and their attachments)
  const result = deleteEmails(emailIds)

  // Delete email_thread_contacts junction records
  db.delete(emailThreadContacts).where(eq(emailThreadContacts.threadId, threadId)).run()

  // Delete the thread
  db.delete(emailThreads).where(eq(emailThreads.id, threadId)).run()

  return { success: true, ...result }
}

/**
 * Delete multiple threads efficiently
 */
export function deleteThreads(threadIds: number[]): { threadsDeleted: number; emailsDeleted: number; attachmentsDeleted: number } {
  if (threadIds.length === 0) return { threadsDeleted: 0, emailsDeleted: 0, attachmentsDeleted: 0 }

  // Get all email IDs in these threads
  const threadEmails = db
    .select({ id: emails.id })
    .from(emails)
    .where(inArray(emails.threadId, threadIds))
    .all()

  const emailIds = threadEmails.map(e => e.id)

  // Delete all emails (and their attachments)
  const result = deleteEmails(emailIds)

  // Delete email_thread_contacts junction records
  db.delete(emailThreadContacts).where(inArray(emailThreadContacts.threadId, threadIds)).run()

  // Delete the threads
  db.delete(emailThreads).where(inArray(emailThreads.id, threadIds)).run()

  return { threadsDeleted: threadIds.length, ...result }
}

/**
 * Find and delete threads that have no emails
 */
export function cleanupEmptyThreads(): { threadsDeleted: number } {
  // Find threads with no emails
  const emptyThreads = db
    .select({ id: emailThreads.id })
    .from(emailThreads)
    .leftJoin(emails, eq(emails.threadId, emailThreads.id))
    .groupBy(emailThreads.id)
    .having(sql`COUNT(${emails.id}) = 0`)
    .all()

  const threadIds = emptyThreads.map(t => t.id)

  if (threadIds.length === 0) return { threadsDeleted: 0 }

  // Delete email_thread_contacts junction records
  db.delete(emailThreadContacts).where(inArray(emailThreadContacts.threadId, threadIds)).run()

  // Delete the empty threads
  db.delete(emailThreads).where(inArray(emailThreads.id, threadIds)).run()

  return { threadsDeleted: threadIds.length }
}

/**
 * Delete a contact and all their threads/emails
 * WARNING: This is destructive - use with caution
 */
export function deleteContact(contactId: number): {
  success: boolean
  threadsDeleted: number
  emailsDeleted: number
  attachmentsDeleted: number
} {
  // Find all threads where this contact is the creator
  const contactThreads = db
    .select({ id: emailThreads.id })
    .from(emailThreads)
    .where(eq(emailThreads.creatorId, contactId))
    .all()

  const threadIds = contactThreads.map(t => t.id)

  // Delete all threads created by this contact
  const result = deleteThreads(threadIds)

  // Remove contact from any junction tables (they may be recipient in other threads)
  db.delete(emailContacts).where(eq(emailContacts.contactId, contactId)).run()
  db.delete(emailThreadContacts).where(eq(emailThreadContacts.contactId, contactId)).run()

  // Delete the contact
  db.delete(contacts).where(eq(contacts.id, contactId)).run()

  return { success: true, ...result }
}

