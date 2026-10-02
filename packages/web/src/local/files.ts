import { db } from './db'
import { opfsRead, opfsWrite, opfsDelete } from './opfs'

export { attachmentKey, draftAttachmentKey } from './opfs'

/**
 * File storage for the page: OPFS where available, IndexedDB otherwise.
 *
 * Downloaded attachments are written by the service worker as they are
 * fetched; the page writes files attached to drafts and deletes files when
 * their thread is evicted.
 */

export async function putFile(key: string, blob: Blob, filename?: string): Promise<void> {
  const stored = await opfsWrite(key, blob, { type: blob.type || 'application/octet-stream', filename })
  if (!stored) {
    await db.files.put({ key, blob })
  }
}

export async function getFile(key: string): Promise<Blob | null> {
  const stored = await opfsRead(key)
  if (stored) return stored.blob

  const fallback = await db.files.get(key)
  return fallback?.blob ?? null
}

export async function deleteFiles(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  await Promise.all(keys.map(key => opfsDelete(key)))
  await db.files.bulkDelete(keys)
}
