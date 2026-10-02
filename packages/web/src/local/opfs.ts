/**
 * Attachment storage in the Origin Private File System.
 *
 * Used by both the page and the service worker, so it must not import
 * anything that only works in one of them.
 *
 * Each file is stored as two entries: the bytes under `key`, and a small
 * `key.meta` JSON holding its content type. The meta entry is written last,
 * so a file with no meta is an incomplete write and is treated as missing.
 */

const DIRECTORY = 'attachments'

export interface StoredFileMeta {
  type: string
  filename?: string
}

export const attachmentKey = (attachmentId: number | string) => `att-${attachmentId}`
export const draftAttachmentKey = (attachmentId: string) => `draft-${attachmentId}`

async function getDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory()
    return await root.getDirectoryHandle(DIRECTORY, { create: true })
  } catch {
    // OPFS unavailable (unsupported browser, private mode, ...)
    return null
  }
}

export async function opfsRead(key: string): Promise<{ blob: Blob; meta: StoredFileMeta } | null> {
  const dir = await getDirectory()
  if (!dir) return null

  try {
    const metaFile = await (await dir.getFileHandle(`${key}.meta`)).getFile()
    const meta = JSON.parse(await metaFile.text()) as StoredFileMeta
    const file = await (await dir.getFileHandle(key)).getFile()
    return { blob: file.slice(0, file.size, meta.type), meta }
  } catch {
    return null
  }
}

export async function opfsWrite(key: string, blob: Blob, meta: StoredFileMeta): Promise<boolean> {
  const dir = await getDirectory()
  if (!dir) return false

  try {
    const write = async (name: string, data: Blob | string) => {
      const handle = await dir.getFileHandle(name, { create: true })
      const writable = await handle.createWritable()
      await writable.write(data)
      await writable.close()
    }

    await write(key, blob)
    await write(`${key}.meta`, JSON.stringify(meta))
    return true
  } catch {
    // Clean up whatever was written so a partial file is never served
    await opfsDelete(key)
    return false
  }
}

export async function opfsDelete(key: string): Promise<void> {
  const dir = await getDirectory()
  if (!dir) return

  for (const name of [`${key}.meta`, key]) {
    try {
      await dir.removeEntry(name)
    } catch {
      // Not there - nothing to do
    }
  }
}
