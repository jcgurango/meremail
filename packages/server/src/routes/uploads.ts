import { Hono } from 'hono'
import { randomUUID } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import { createReadStream, existsSync } from 'fs'
import { Readable } from 'stream'
import { join, extname } from 'path'
import { eq } from 'drizzle-orm'
import { db, config, attachments, emails } from '@meremail/shared'

export const uploadsRoutes = new Hono()

// POST /api/uploads
uploadsRoutes.post('/', async (c) => {
  const body = await c.req.parseBody()

  const file = body['file']
  if (!file || !(file instanceof File)) {
    return c.json({ error: 'No file uploaded' }, 400)
  }

  const emailIdRaw = body['emailId']
  const isInlineRaw = body['isInline']

  const emailId = emailIdRaw ? parseInt(String(emailIdRaw), 10) : null
  const isInline = String(isInlineRaw) === 'true'

  // If emailId provided, verify it's a draft
  if (emailId && !isNaN(emailId)) {
    const email = db.select({ status: emails.status })
      .from(emails)
      .where(eq(emails.id, emailId))
      .get()

    if (!email) {
      return c.json({ error: 'Draft not found' }, 404)
    }
    if (email.status !== 'draft') {
      return c.json({ error: 'Can only attach files to drafts' }, 400)
    }
  }

  // Check file size
  if (file.size > config.uploads.maxSize) {
    const maxMB = Math.round(config.uploads.maxSize / 1024 / 1024)
    return c.json({ error: `File too large. Maximum size is ${maxMB}MB` }, 413)
  }

  // Generate unique filename
  const ext = extname(file.name)
  const uniqueId = randomUUID()
  const storedFilename = `${uniqueId}${ext}`

  // Ensure upload directory exists
  await mkdir(config.uploads.path, { recursive: true })

  // Write file
  const filePath = join(config.uploads.path, storedFilename)
  const arrayBuffer = await file.arrayBuffer()
  await writeFile(filePath, Buffer.from(arrayBuffer))

  // If emailId provided, create attachment record
  let attachmentId: number | string = uniqueId
  if (emailId && !isNaN(emailId)) {
    const result = db.insert(attachments)
      .values({
        emailId,
        filename: file.name || 'unnamed',
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        filePath: storedFilename,
        isInline,
      })
      .run()
    attachmentId = Number(result.lastInsertRowid)
  }

  return c.json({
    id: attachmentId,
    filename: file.name || 'unnamed',
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    url: `/api/uploads/${storedFilename}`,
    isInline,
  })
})

// GET /api/uploads/:filename
uploadsRoutes.get('/:filename', async (c) => {
  const filename = c.req.param('filename')
  const filePath = join(config.uploads.path, filename)

  if (!existsSync(filePath)) {
    return c.json({ error: 'File not found' }, 404)
  }

  const stream = createReadStream(filePath)
  const webStream = Readable.toWeb(stream) as ReadableStream

  // Determine content type from extension
  const ext = extname(filename).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }

  return new Response(webStream, {
    headers: {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
    },
  })
})
