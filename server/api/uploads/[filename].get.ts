import { createError, setHeader, send } from 'h3'
import { readFile, stat } from 'fs/promises'
import { join, extname } from 'path'
import { config } from '../../config'

// Simple mime type lookup
const mimeTypes: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
}

export default defineEventHandler(async (event) => {
  const filename = getRouterParam(event, 'filename')
  if (!filename) {
    throw createError({ statusCode: 400, message: 'Filename required' })
  }

  // Sanitize filename to prevent directory traversal
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '')
  if (sanitizedFilename !== filename) {
    throw createError({ statusCode: 400, message: 'Invalid filename' })
  }

  const filePath = join(config.uploads.path, sanitizedFilename)

  try {
    await stat(filePath)
  } catch {
    throw createError({ statusCode: 404, message: 'File not found' })
  }

  const ext = extname(sanitizedFilename).toLowerCase()
  const contentType = mimeTypes[ext] || 'application/octet-stream'

  const data = await readFile(filePath)

  setHeader(event, 'Content-Type', contentType)
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')

  return send(event, data)
})
