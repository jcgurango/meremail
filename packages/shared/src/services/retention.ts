import { sql, and, lt, eq } from 'drizzle-orm'
import { db } from '../db'
import { emailThreads } from '../db/schema'
import { deleteThread } from './delete'

// Folder IDs
const JUNK_FOLDER_ID = 2
const TRASH_FOLDER_ID = 3

// Retention period in days
const RETENTION_DAYS = 30

interface CleanupResult {
  threadsDeleted: number
  emailsDeleted: number
  attachmentsDeleted: number
  errors: string[]
}

/**
 * Clean up expired items in Trash and Junk folders
 * Items are permanently deleted after RETENTION_DAYS days
 */
export async function cleanupExpiredItems(): Promise<CleanupResult> {
  const result: CleanupResult = {
    threadsDeleted: 0,
    emailsDeleted: 0,
    attachmentsDeleted: 0,
    errors: [],
  }

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS)
  // Timestamp columns are stored in seconds
  const cutoff = Math.floor(cutoffDate.getTime() / 1000)

  // Find threads that have been in Trash/Junk for more than RETENTION_DAYS
  // For Trash: use trashedAt
  // For Junk: use createdAt (since Junk items don't have trashedAt set)
  const expiredThreads = db
    .select({ id: emailThreads.id })
    .from(emailThreads)
    .where(
      sql`(
        (${emailThreads.folderId} = ${TRASH_FOLDER_ID} AND ${emailThreads.trashedAt} < ${cutoff})
        OR
        (${emailThreads.folderId} = ${JUNK_FOLDER_ID} AND ${emailThreads.createdAt} < ${cutoff})
      )`
    )
    .all()

  console.log(`[Retention] Found ${expiredThreads.length} expired threads to delete`)

  for (const thread of expiredThreads) {
    try {
      const deleted = deleteThread(thread.id)
      result.emailsDeleted += deleted.emailsDeleted
      result.attachmentsDeleted += deleted.attachmentsDeleted
      result.threadsDeleted++

    } catch (err) {
      result.errors.push(`Failed to delete thread ${thread.id}: ${err}`)
    }
  }

  return result
}

/**
 * Get counts of items pending cleanup
 */
export function getRetentionStats(): { trashCount: number; junkCount: number; oldestTrashed: Date | null; oldestJunk: Date | null } {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS)

  const trashCount = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emailThreads)
    .where(and(
      eq(emailThreads.folderId, TRASH_FOLDER_ID),
      lt(emailThreads.trashedAt, cutoffDate)
    ))
    .get()?.count || 0

  const junkCount = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emailThreads)
    .where(and(
      eq(emailThreads.folderId, JUNK_FOLDER_ID),
      lt(emailThreads.createdAt, cutoffDate)
    ))
    .get()?.count || 0

  const oldestTrashed = db
    .select({ trashedAt: emailThreads.trashedAt })
    .from(emailThreads)
    .where(eq(emailThreads.folderId, TRASH_FOLDER_ID))
    .orderBy(emailThreads.trashedAt)
    .limit(1)
    .get()?.trashedAt || null

  const oldestJunk = db
    .select({ createdAt: emailThreads.createdAt })
    .from(emailThreads)
    .where(eq(emailThreads.folderId, JUNK_FOLDER_ID))
    .orderBy(emailThreads.createdAt)
    .limit(1)
    .get()?.createdAt || null

  return { trashCount, junkCount, oldestTrashed, oldestJunk }
}
