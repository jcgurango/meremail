import { Hono } from 'hono'
import { eq, sql } from 'drizzle-orm'
import { db, folders, emailThreads, emails } from '@meremail/shared'

export const foldersRoutes = new Hono()

// GET /api/folders
foldersRoutes.get('/', async (c) => {
  const folderList = db
    .select({
      id: folders.id,
      name: folders.name,
      imapFolder: folders.imapFolder,
      position: folders.position,
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
