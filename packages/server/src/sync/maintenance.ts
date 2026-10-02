import { sqlite, deleteDraftAttachment } from '@meremail/shared'
import { WINDOW_DAYS } from './feed'

// Deletion records are kept for twice the client window. A client that has
// been away longer than the window starts over anyway.
const TOMBSTONE_RETENTION_DAYS = WINDOW_DAYS * 2
const APPLIED_ACTION_RETENTION_DAYS = WINDOW_DAYS
const ORPHANED_UPLOAD_RETENTION_DAYS = 7

function daysAgo(days: number): number {
  return Math.floor(Date.now() / 1000) - days * 24 * 60 * 60
}

/**
 * Prune sync bookkeeping that clients can no longer need
 */
export function cleanupSyncData(): { tombstones: number; actions: number; uploads: number } {
  const tombstones = sqlite.transaction(() => {
    const cutoff = daysAgo(TOMBSTONE_RETENTION_DAYS)
    const newest = sqlite.prepare('SELECT MAX(rev) AS rev FROM tombstones WHERE created_at < ?').get(cutoff) as { rev: number | null }
    if (newest.rev === null) return 0

    // Clients with a cursor older than this have missed deletions and must start over
    sqlite.prepare('UPDATE sync_state SET tombstone_floor = MAX(tombstone_floor, ?) WHERE id = 1').run(newest.rev)
    return sqlite.prepare('DELETE FROM tombstones WHERE created_at < ?').run(cutoff).changes
  })()

  const actions = sqlite
    .prepare('DELETE FROM applied_actions WHERE applied_at < ?')
    .run(daysAgo(APPLIED_ACTION_RETENTION_DAYS)).changes

  // Uploads whose draft never arrived, or was deleted before the upload landed
  const orphans = sqlite.prepare(`
    SELECT id FROM draft_attachments
    WHERE created_at < ? AND draft_id NOT IN (SELECT id FROM drafts)
  `).all(daysAgo(ORPHANED_UPLOAD_RETENTION_DAYS)) as { id: string }[]
  for (const orphan of orphans) {
    deleteDraftAttachment(orphan.id)
  }

  return { tombstones, actions, uploads: orphans.length }
}
