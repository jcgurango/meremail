import { Hono } from 'hono'
import { eq, sql, inArray } from 'drizzle-orm'
import { db, folders, emailThreads, emails, emailContacts, emailThreadContacts, attachments, resolveAttachmentPath } from '@meremail/shared'

export const foldersRoutes = new Hono()

// GET /api/folders
foldersRoutes.get('/', async (c) => {
  const folderList = db
    .select({
      id: folders.id,
      name: folders.name,
      imapFolder: folders.imapFolder,
      position: folders.position,
      isSystem: folders.isSystem,
      notificationsEnabled: folders.notificationsEnabled,
      showUnreadCount: folders.showUnreadCount,
      syncOffline: folders.syncOffline,
    })
    .from(folders)
    .orderBy(folders.position)
    .all()

  // Get unread counts for each folder
  const foldersWithCounts = folderList.map(folder => {
    const unreadCount = db
      .select({ count: sql<number>`COUNT(DISTINCT ${emailThreads.id})` })
      .from(emailThreads)
      .innerJoin(emails, eq(emails.threadId, emailThreads.id))
      .where(sql`${emailThreads.folderId} = ${folder.id} AND ${emails.readAt} IS NULL`)
      .get()

    return {
      ...folder,
      unreadCount: unreadCount?.count || 0,
    }
  })

  return c.json({ folders: foldersWithCounts })
})

// PATCH /api/threads/:id/folder
foldersRoutes.patch('/threads/:id/folder', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid thread ID' }, 400)
  }

  const body = await c.req.json()
  const folderId = body?.folderId

  if (typeof folderId !== 'number') {
    return c.json({ error: 'folderId must be a number' }, 400)
  }

  // Verify folder exists
  const folder = db
    .select()
    .from(folders)
    .where(eq(folders.id, folderId))
    .get()

  if (!folder) {
    return c.json({ error: 'Folder not found' }, 404)
  }

  db.update(emailThreads)
    .set({ folderId })
    .where(eq(emailThreads.id, id))
    .run()

  return c.json({ success: true, threadId: id, folderId })
})

// POST /api/folders - Create new folder
foldersRoutes.post('/', async (c) => {
  const body = await c.req.json()

  if (!body.name || typeof body.name !== 'string') {
    return c.json({ error: 'name is required' }, 400)
  }

  // Get max position for new folder
  const maxPosition = db
    .select({ max: sql<number>`MAX(${folders.position})` })
    .from(folders)
    .get()?.max || 0

  const now = new Date()

  const result = db
    .insert(folders)
    .values({
      name: body.name.trim(),
      imapFolder: null,
      position: maxPosition + 1,
      isSystem: false,
      // Sensible defaults for custom folders
      notificationsEnabled: false,
      showUnreadCount: true,
      syncOffline: true,
      createdAt: now,
    })
    .returning()
    .get()

  return c.json({ folder: result }, 201)
})

// PATCH /api/folders/:id - Update folder
foldersRoutes.patch('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid folder ID' }, 400)
  }

  const existingFolder = db
    .select()
    .from(folders)
    .where(eq(folders.id, id))
    .get()

  if (!existingFolder) {
    return c.json({ error: 'Folder not found' }, 404)
  }

  const body = await c.req.json()

  // System folders cannot have their name changed
  if (existingFolder.isSystem && body.name !== undefined) {
    return c.json({ error: 'Cannot rename system folders' }, 400)
  }

  if (body.name !== undefined && typeof body.name !== 'string') {
    return c.json({ error: 'name must be a string' }, 400)
  }

  const updates: Partial<typeof folders.$inferInsert> = {}
  if (body.name !== undefined) updates.name = body.name.trim()
  if (body.notificationsEnabled !== undefined) updates.notificationsEnabled = body.notificationsEnabled
  if (body.showUnreadCount !== undefined) updates.showUnreadCount = body.showUnreadCount
  if (body.syncOffline !== undefined) updates.syncOffline = body.syncOffline

  db.update(folders)
    .set(updates)
    .where(eq(folders.id, id))
    .run()

  const updatedFolder = db
    .select()
    .from(folders)
    .where(eq(folders.id, id))
    .get()

  return c.json({ folder: updatedFolder })
})

// DELETE /api/folders/:id - Delete folder and all its emails
foldersRoutes.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid folder ID' }, 400)
  }

  const existingFolder = db
    .select()
    .from(folders)
    .where(eq(folders.id, id))
    .get()

  if (!existingFolder) {
    return c.json({ error: 'Folder not found' }, 404)
  }

  if (existingFolder.isSystem) {
    return c.json({ error: 'Cannot delete system folders' }, 400)
  }

  // Get all threads in this folder
  const folderThreads = db
    .select({ id: emailThreads.id })
    .from(emailThreads)
    .where(eq(emailThreads.folderId, id))
    .all()

  const threadIds = folderThreads.map(t => t.id)

  if (threadIds.length > 0) {
    // Get all emails in these threads
    const folderEmails = db
      .select({ id: emails.id })
      .from(emails)
      .where(inArray(emails.threadId, threadIds))
      .all()

    const emailIds = folderEmails.map(e => e.id)

    if (emailIds.length > 0) {
      // Get and delete attachment files
      const folderAttachments = db
        .select({ filePath: attachments.filePath })
        .from(attachments)
        .where(inArray(attachments.emailId, emailIds))
        .all()

      const { existsSync, unlinkSync } = await import('fs')
      for (const attachment of folderAttachments) {
        try {
          const resolvedPath = resolveAttachmentPath(attachment.filePath)
          if (existsSync(resolvedPath)) {
            unlinkSync(resolvedPath)
          }
        } catch (err) {
          console.error(`Failed to delete attachment file ${attachment.filePath}:`, err)
        }
      }

      // Delete attachment records
      db.delete(attachments).where(inArray(attachments.emailId, emailIds)).run()

      // Delete email contacts
      db.delete(emailContacts).where(inArray(emailContacts.emailId, emailIds)).run()
    }

    // Delete thread contacts
    db.delete(emailThreadContacts).where(inArray(emailThreadContacts.threadId, threadIds)).run()

    // Delete emails
    db.delete(emails).where(inArray(emails.threadId, threadIds)).run()

    // Delete threads
    db.delete(emailThreads).where(inArray(emailThreads.id, threadIds)).run()
  }

  // Delete folder
  db.delete(folders).where(eq(folders.id, id)).run()

  return c.json({ success: true, deletedThreads: threadIds.length })
})

// POST /api/folders/reorder - Reorder folders
foldersRoutes.post('/reorder', async (c) => {
  const body = await c.req.json()

  if (!Array.isArray(body.positions)) {
    return c.json({ error: 'positions array is required' }, 400)
  }

  // positions should be an array of { id: number, position: number }
  for (const item of body.positions) {
    if (typeof item.id !== 'number' || typeof item.position !== 'number') {
      return c.json({ error: 'Each position must have id and position as numbers' }, 400)
    }

    db.update(folders)
      .set({ position: item.position })
      .where(eq(folders.id, item.id))
      .run()
  }

  return c.json({ success: true })
})
