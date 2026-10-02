import { eq, inArray } from 'drizzle-orm'
import { unlinkSync, existsSync } from 'fs'
import { db } from '../db'
import { resolveAttachmentPath } from '../config'
import { drafts, draftAttachments } from '../db/schema'

function deleteDraftAttachmentFile(filePath: string): void {
  const resolvedPath = resolveAttachmentPath(filePath)
  if (!existsSync(resolvedPath)) return
  try {
    unlinkSync(resolvedPath)
  } catch (e) {
    console.error(`Failed to delete file ${resolvedPath}:`, e)
  }
}

/**
 * Delete a single uploaded draft attachment (file and record)
 */
export function deleteDraftAttachment(attachmentId: string): boolean {
  const attachment = db
    .select({ filePath: draftAttachments.filePath })
    .from(draftAttachments)
    .where(eq(draftAttachments.id, attachmentId))
    .get()

  if (!attachment) return false

  deleteDraftAttachmentFile(attachment.filePath)
  db.delete(draftAttachments).where(eq(draftAttachments.id, attachmentId)).run()
  return true
}

/**
 * Delete drafts along with their uploaded files
 */
export function deleteDrafts(draftIds: string[]): { draftsDeleted: number } {
  if (draftIds.length === 0) return { draftsDeleted: 0 }

  const files = db
    .select({ filePath: draftAttachments.filePath })
    .from(draftAttachments)
    .where(inArray(draftAttachments.draftId, draftIds))
    .all()

  for (const file of files) {
    deleteDraftAttachmentFile(file.filePath)
  }

  db.delete(draftAttachments).where(inArray(draftAttachments.draftId, draftIds)).run()
  const result = db.delete(drafts).where(inArray(drafts.id, draftIds)).run()

  return { draftsDeleted: result.changes }
}

/**
 * Delete all drafts replying into the given threads
 */
export function deleteDraftsForThreads(threadIds: number[]): { draftsDeleted: number } {
  if (threadIds.length === 0) return { draftsDeleted: 0 }

  const threadDrafts = db
    .select({ id: drafts.id })
    .from(drafts)
    .where(inArray(drafts.threadId, threadIds))
    .all()

  return deleteDrafts(threadDrafts.map(d => d.id))
}
