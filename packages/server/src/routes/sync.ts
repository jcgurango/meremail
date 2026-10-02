import { Hono } from 'hono'
import { randomUUID } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import { createReadStream, existsSync } from 'fs'
import { Readable } from 'stream'
import { join, extname } from 'path'
import { eq } from 'drizzle-orm'
import { db, config, draftAttachments, resolveAttachmentPath } from '@meremail/shared'
import type { SyncAction, SyncDraftAttachment } from '@meremail/shared'
import { bootstrap, changes, fetchThreads, folderPage } from '../sync/feed'
import { applyActions } from '../sync/actions'

export const syncRoutes = new Hono()
export const draftAttachmentsRoutes = new Hono()

const MAX_THREADS_PER_FETCH = 100
const MAX_ACTIONS_PER_BATCH = 100

// GET /api/sync/bootstrap
// Starting snapshot for a client with no local data
syncRoutes.get('/bootstrap', (c) => {
  return c.json(bootstrap())
})

// GET /api/sync/changes?since=<cursor>
// Everything that changed after the cursor, one page at a time
syncRoutes.get('/changes', (c) => {
  const since = parseInt(c.req.query('since') || '')
  if (isNaN(since) || since < 0) {
    return c.json({ error: 'since must be a cursor from a previous sync' }, 400)
  }

  return c.json(changes(since))
})

// POST /api/sync/threads
// Full threads by ID
syncRoutes.post('/threads', async (c) => {
  const body = await c.req.json<{ ids: number[] }>()

  if (!Array.isArray(body.ids) || !body.ids.every(id => typeof id === 'number')) {
    return c.json({ error: 'ids must be an array of numbers' }, 400)
  }
  if (body.ids.length > MAX_THREADS_PER_FETCH) {
    return c.json({ error: `At most ${MAX_THREADS_PER_FETCH} threads per request` }, 400)
  }

  return c.json(fetchThreads(body.ids))
})

// GET /api/sync/folder-threads?folderId=&before=&limit=
// Page backwards through a folder, for mail the client doesn't hold
syncRoutes.get('/folder-threads', (c) => {
  const folderId = parseInt(c.req.query('folderId') || '')
  if (isNaN(folderId)) {
    return c.json({ error: 'folderId is required' }, 400)
  }

  const beforeParam = c.req.query('before')
  const before = beforeParam ? parseInt(beforeParam) : null
  const limit = Math.min(parseInt(c.req.query('limit') || '25'), 100)

  return c.json(folderPage(folderId, before !== null && !isNaN(before) ? before : null, limit))
})

// POST /api/sync/actions
// Apply a batch of client mutations, in order
syncRoutes.post('/actions', async (c) => {
  const body = await c.req.json<{ actions: SyncAction[] }>()

  if (!Array.isArray(body.actions)) {
    return c.json({ error: 'actions must be an array' }, 400)
  }
  if (body.actions.length > MAX_ACTIONS_PER_BATCH) {
    return c.json({ error: `At most ${MAX_ACTIONS_PER_BATCH} actions per request` }, 400)
  }

  return c.json({ results: applyActions(body.actions) })
})

// PUT /api/draft-attachments/:id
// Upload a file for a draft. The ID is chosen by the client, so a retried
// upload returns the existing record instead of storing the file twice.
draftAttachmentsRoutes.put('/:id', async (c) => {
  const id = c.req.param('id')
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    return c.json({ error: 'Invalid attachment ID' }, 400)
  }

  const existing = db.select().from(draftAttachments).where(eq(draftAttachments.id, id)).get()
  if (existing) {
    return c.json(toSyncDraftAttachment(existing))
  }

  const body = await c.req.parseBody()

  const file = body['file']
  if (!file || !(file instanceof File)) {
    return c.json({ error: 'No file uploaded' }, 400)
  }

  const draftId = String(body['draftId'] || '')
  if (!draftId) {
    return c.json({ error: 'draftId is required' }, 400)
  }

  // Check file size
  if (file.size > config.uploads.maxSize) {
    const maxMB = Math.round(config.uploads.maxSize / 1024 / 1024)
    return c.json({ error: `File too large. Maximum size is ${maxMB}MB` }, 413)
  }

  // Generate unique filename
  const storedFilename = `${randomUUID()}${extname(file.name)}`

  // Ensure upload directory exists
  await mkdir(config.uploads.path, { recursive: true })

  // Write file
  const arrayBuffer = await file.arrayBuffer()
  await writeFile(join(config.uploads.path, storedFilename), Buffer.from(arrayBuffer))

  const created = db
    .insert(draftAttachments)
    .values({
      id,
      draftId,
      filename: file.name || 'unnamed',
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      filePath: storedFilename,
      isInline: String(body['isInline']) === 'true',
    })
    .returning()
    .get()

  return c.json(toSyncDraftAttachment(created))
})

// GET /api/draft-attachments/:id
draftAttachmentsRoutes.get('/:id', (c) => {
  const attachment = db
    .select()
    .from(draftAttachments)
    .where(eq(draftAttachments.id, c.req.param('id')))
    .get()

  if (!attachment) {
    return c.json({ error: 'Attachment not found' }, 404)
  }

  const resolvedPath = resolveAttachmentPath(attachment.filePath)
  if (!existsSync(resolvedPath)) {
    return c.json({ error: 'Attachment file not found on disk' }, 404)
  }

  const stream = createReadStream(resolvedPath)
  const webStream = Readable.toWeb(stream) as ReadableStream

  return new Response(webStream, {
    headers: {
      'Content-Type': attachment.mimeType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${attachment.filename}"`,
      ...(attachment.size ? { 'Content-Length': String(attachment.size) } : {}),
    },
  })
})

function toSyncDraftAttachment(row: typeof draftAttachments.$inferSelect): SyncDraftAttachment {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    size: row.size,
    isInline: row.isInline,
  }
}
