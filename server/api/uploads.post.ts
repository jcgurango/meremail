import { createError, readMultipartFormData } from 'h3'
import { randomUUID } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import { join, extname } from 'path'
import { config } from '../config'
import { db } from '../db'
import { attachments, emails } from '../db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const formData = await readMultipartFormData(event)

  if (!formData || formData.length === 0) {
    throw createError({ statusCode: 400, message: 'No file uploaded' })
  }

  const file = formData.find(f => f.name === 'file')
  if (!file || !file.data) {
    throw createError({ statusCode: 400, message: 'No file found in request' })
  }

  // Get optional emailId (draft ID) and isInline flag
  const emailIdField = formData.find(f => f.name === 'emailId')
  const isInlineField = formData.find(f => f.name === 'isInline')

  const emailId = emailIdField?.data ? parseInt(emailIdField.data.toString(), 10) : null
  const isInline = isInlineField?.data?.toString() === 'true'

  // If emailId provided, verify it's a draft
  if (emailId) {
    const email = db.select({ status: emails.status })
      .from(emails)
      .where(eq(emails.id, emailId))
      .get()

    if (!email) {
      throw createError({ statusCode: 404, message: 'Draft not found' })
    }
    if (email.status !== 'draft') {
      throw createError({ statusCode: 400, message: 'Can only attach files to drafts' })
    }
  }

  // Check file size
  if (file.data.length > config.uploads.maxSize) {
    const maxMB = Math.round(config.uploads.maxSize / 1024 / 1024)
    throw createError({ statusCode: 413, message: `File too large. Maximum size is ${maxMB}MB` })
  }

  // Generate unique filename
  const ext = file.filename ? extname(file.filename) : ''
  const uniqueId = randomUUID()
  const storedFilename = `${uniqueId}${ext}`

  // Ensure upload directory exists
  await mkdir(config.uploads.path, { recursive: true })

  // Write file
  const filePath = join(config.uploads.path, storedFilename)
  await writeFile(filePath, file.data)

  // If emailId provided, create attachment record in database
  let attachmentId: number | null = null
  if (emailId) {
    const result = db.insert(attachments)
      .values({
        emailId,
        filename: file.filename || 'unnamed',
        mimeType: file.type || 'application/octet-stream',
        size: file.data.length,
        filePath: storedFilename,
        isInline,
      })
      .run()
    attachmentId = Number(result.lastInsertRowid)
  }

  // Return file metadata
  return {
    id: attachmentId || uniqueId,
    filename: file.filename || 'unnamed',
    mimeType: file.type || 'application/octet-stream',
    size: file.data.length,
    url: `/api/uploads/${storedFilename}`,
    isInline,
  }
})
