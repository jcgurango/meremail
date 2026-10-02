import { Hono } from 'hono'
import { createReadStream, existsSync } from 'fs'
import { Readable } from 'stream'
import { join, extname, basename } from 'path'
import { config } from '@meremail/shared'

export const uploadsRoutes = new Hono()

// Uploads now go through /api/draft-attachments. This remains so that emails
// written before then, which reference inline images by upload URL, still render.

// GET /api/uploads/:filename
uploadsRoutes.get('/:filename', async (c) => {
  const filename = basename(c.req.param('filename'))
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
