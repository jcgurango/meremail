import { Hono } from 'hono'
import { eq, desc, asc, sql, and, isNull, inArray } from 'drizzle-orm'
import {
  db,
  emails,
  emailThreads,
  contacts,
  emailContacts,
  emailThreadContacts,
  attachments,
  folders,
} from '@meremail/shared'
import { proxyImagesInHtml } from '../utils/proxy-images'
import { replaceCidReferences } from '../utils/replace-cid'

export const threadsRoutes = new Hono()

// Strip HTML tags and decode entities for plain text snippets
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// GET /api/threads
threadsRoutes.get('/', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '25'), 100)
  const offset = parseInt(c.req.query('offset') || '0')
  const folderIdParam = c.req.query('folderId')
  const queue = c.req.query('queue') // 'reply_later' or 'set_aside'

  let whereClause
  let orderByClause
  let needsContactJoin = false

  if (queue === 'reply_later') {
    whereClause = sql`${emailThreads.replyLaterAt} IS NOT NULL OR EXISTS (
      SELECT 1 FROM ${emails} WHERE ${emails.threadId} = ${emailThreads.id} AND ${emails.status} = 'draft'
    )`
    orderByClause = [
      asc(sql`COALESCE(${emailThreads.replyLaterAt}, sort_date)`),
      desc(sql`sort_date`)
    ]
  } else if (queue === 'set_aside') {
    whereClause = sql`${emailThreads.setAsideAt} IS NOT NULL`
    orderByClause = [
      desc(emailThreads.setAsideAt),
      desc(sql`sort_date`)
    ]
  } else {
    // Filter by folder
    const folderId = folderIdParam ? parseInt(folderIdParam) : 1 // Default to Inbox (id=1)
    whereClause = eq(emailThreads.folderId, folderId)
    // Sort: drafts first, then unread, then by most recent read time (for read threads) or email date
    orderByClause = [
      desc(sql`CASE WHEN draft_count > 0 AND draft_count = total_count THEN 1 ELSE 0 END`),
      desc(sql`CASE WHEN unread_count > 0 THEN 1 ELSE 0 END`),
      desc(sql`COALESCE(last_read_at, sort_date)`)
    ]
  }

  const threadsWithUnread = db
    .select({
      id: emailThreads.id,
      subject: emailThreads.subject,
      createdAt: emailThreads.createdAt,
      replyLaterAt: emailThreads.replyLaterAt,
      setAsideAt: emailThreads.setAsideAt,
      folderId: emailThreads.folderId,
      latestEmailAt: sql<number>`MAX(COALESCE(${emails.sentAt}, ${emails.queuedAt}, ${emails.createdAt}))`.as('latest_email_at'),
      sortDate: sql<number>`MAX(COALESCE(${emails.sentAt}, ${emails.queuedAt}, ${emails.createdAt}))`.as('sort_date'),
      lastReadAt: sql<number>`MAX(${emails.readAt})`.as('last_read_at'),
      unreadCount: sql<number>`SUM(CASE WHEN ${emails.readAt} IS NULL THEN 1 ELSE 0 END)`.as('unread_count'),
      totalCount: sql<number>`COUNT(${emails.id})`.as('total_count'),
      draftCount: sql<number>`SUM(CASE WHEN ${emails.status} = 'draft' THEN 1 ELSE 0 END)`.as('draft_count'),
      queuedCount: sql<number>`SUM(CASE WHEN ${emails.status} = 'queued' THEN 1 ELSE 0 END)`.as('queued_count'),
    })
    .from(emailThreads)
    .innerJoin(emails, eq(emails.threadId, emailThreads.id))
    .where(whereClause)
    .groupBy(emailThreads.id)
    .orderBy(...orderByClause)
    .limit(limit + 1)
    .offset(offset)
    .all()

  const hasMore = threadsWithUnread.length > limit
  const threads = hasMore ? threadsWithUnread.slice(0, limit) : threadsWithUnread

  const threadsWithParticipants = threads.map((thread) => {
    const participantsRaw = db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        isMe: contacts.isMe,
        role: emailThreadContacts.role,
      })
      .from(emailThreadContacts)
      .innerJoin(contacts, eq(contacts.id, emailThreadContacts.contactId))
      .where(eq(emailThreadContacts.threadId, thread.id))
      .all()

    const participantsMap = new Map<number, typeof participantsRaw[0]>()
    for (const p of participantsRaw) {
      const existing = participantsMap.get(p.id)
      if (!existing || (p.role === 'sender' && existing.role !== 'sender')) {
        participantsMap.set(p.id, p)
      }
    }
    const participants = Array.from(participantsMap.values())

    const latestEmail = db
      .select({
        contentText: emails.contentText,
        contentHtml: emails.contentHtml,
      })
      .from(emails)
      .innerJoin(contacts, eq(contacts.id, emails.senderId))
      .where(and(
        eq(emails.threadId, thread.id)
      ))
      .orderBy(desc(emails.sentAt))
      .limit(1)
      .get()

    let snippet = ''
    if (latestEmail) {
      const text = latestEmail.contentText || ''
      const looksLikeCss = /\{[^}]*:[^}]*\}|@media|@font-face|\.[\w-]+\s*\{/i.test(text.substring(0, 500))
      if (text && !looksLikeCss) {
        snippet = text.substring(0, 150)
      } else {
        snippet = stripHtml(latestEmail.contentHtml || '').substring(0, 150)
      }
    }

    return {
      ...thread,
      latestEmailAt: thread.latestEmailAt ? new Date(thread.latestEmailAt * 1000) : null,
      participants: participants.filter((p) => !p.isMe),
      snippet,
    }
  })

  // For Inbox folder, include standalone drafts
  let standaloneDrafts: any[] = []
  const isInboxFolder = !queue && (!folderIdParam || parseInt(folderIdParam) === 1)
  if (isInboxFolder && offset === 0) {
    const draftsRaw = db
      .select({
        id: emails.id,
        subject: emails.subject,
        contentText: emails.contentText,
        createdAt: emails.createdAt,
        senderId: emails.senderId,
      })
      .from(emails)
      .where(and(
        isNull(emails.threadId),
        eq(emails.status, 'draft')
      ))
      .orderBy(desc(emails.createdAt))
      .all()

    standaloneDrafts = draftsRaw.map(draft => {
      const recipientsRaw = db
        .select({
          id: contacts.id,
          name: contacts.name,
          email: contacts.email,
          isMe: contacts.isMe,
          role: emailContacts.role,
        })
        .from(emailContacts)
        .innerJoin(contacts, eq(contacts.id, emailContacts.contactId))
        .where(eq(emailContacts.emailId, draft.id))
        .all()
        .filter(r => r.role !== 'from')

      return {
        type: 'draft' as const,
        id: draft.id,
        subject: draft.subject || '(No subject)',
        createdAt: draft.createdAt,
        replyLaterAt: null,
        setAsideAt: null,
        latestEmailAt: draft.createdAt,
        unreadCount: 0,
        totalCount: 1,
        draftCount: 1,
        queuedCount: 0,
        participants: recipientsRaw.filter(p => !p.isMe),
        snippet: draft.contentText?.substring(0, 150) || '',
      }
    })
  }

  const threadsWithType = threadsWithParticipants.map(t => ({
    ...t,
    type: 'thread' as const,
  }))

  return c.json({
    threads: [...standaloneDrafts, ...threadsWithType],
    hasMore,
  })
})

// GET /api/threads/:id
// Query params:
//   markRead: 'true' (default) or 'false' - whether to mark emails as read
threadsRoutes.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid thread ID' }, 400)
  }

  const markRead = c.req.query('markRead') !== 'false'

  const thread = db
    .select()
    .from(emailThreads)
    .where(eq(emailThreads.id, id))
    .get()

  if (!thread) {
    return c.json({ error: 'Thread not found' }, 404)
  }

  const threadEmails = db
    .select({
      id: emails.id,
      subject: emails.subject,
      contentText: emails.contentText,
      contentHtml: emails.contentHtml,
      sentAt: emails.sentAt,
      receivedAt: emails.receivedAt,
      readAt: emails.readAt,
      senderId: emails.senderId,
      headers: emails.headers,
      messageId: emails.messageId,
      references: emails.references,
      status: emails.status,
      inReplyTo: emails.inReplyTo,
      queuedAt: emails.queuedAt,
      sendAttempts: emails.sendAttempts,
      lastSendError: emails.lastSendError,
    })
    .from(emails)
    .where(eq(emails.threadId, id))
    .orderBy(desc(emails.sentAt))
    .all()

  const emailIds = threadEmails.map(e => e.id)
  const senderIds = [...new Set(threadEmails.map(e => e.senderId).filter(Boolean))] as number[]

  // Batch load senders
  const sendersMap = new Map<number, { id: number; name: string | null; email: string; isMe: boolean }>()
  if (senderIds.length > 0) {
    const senders = db
      .select({ id: contacts.id, name: contacts.name, email: contacts.email, isMe: contacts.isMe })
      .from(contacts)
      .where(inArray(contacts.id, senderIds))
      .all()
    for (const s of senders) {
      sendersMap.set(s.id, s)
    }
  }

  // Batch load recipients
  const recipientsMap = new Map<number, Array<{ id: number; name: string | null; email: string; isMe: boolean; role: string }>>()
  if (emailIds.length > 0) {
    const allRecipients = db
      .select({
        emailId: emailContacts.emailId,
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        isMe: contacts.isMe,
        role: emailContacts.role,
      })
      .from(emailContacts)
      .innerJoin(contacts, eq(contacts.id, emailContacts.contactId))
      .where(inArray(emailContacts.emailId, emailIds))
      .all()
    for (const r of allRecipients) {
      if (r.role === 'from') continue
      const list = recipientsMap.get(r.emailId) || []
      list.push({ id: r.id, name: r.name, email: r.email, isMe: r.isMe, role: r.role })
      recipientsMap.set(r.emailId, list)
    }
  }

  // Batch load attachments
  const attachmentsMap = new Map<number, Array<{ id: number; filename: string; mimeType: string | null; size: number | null; isInline: boolean }>>()
  if (emailIds.length > 0) {
    const allAttachments = db
      .select({
        emailId: attachments.emailId,
        id: attachments.id,
        filename: attachments.filename,
        mimeType: attachments.mimeType,
        size: attachments.size,
        isInline: attachments.isInline,
      })
      .from(attachments)
      .where(inArray(attachments.emailId, emailIds))
      .all()
    for (const a of allAttachments) {
      if (a.isInline) continue
      const list = attachmentsMap.get(a.emailId) || []
      list.push({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size, isInline: a.isInline })
      attachmentsMap.set(a.emailId, list)
    }
  }

  const emailsWithParticipants = threadEmails.map((email) => {
    const sender = email.senderId ? sendersMap.get(email.senderId) || null : null
    const recipients = recipientsMap.get(email.id) || []
    const emailAttachments = attachmentsMap.get(email.id) || []

    let content: string
    if (email.contentHtml) {
      const withCidReplaced = replaceCidReferences(email.contentHtml, email.id)
      content = proxyImagesInHtml(withCidReplaced)
    } else if (email.contentText?.trim()) {
      content = `<pre style="white-space: pre-wrap; font-family: inherit;">${email.contentText}</pre>`
    } else {
      content = ''
    }

    const headers = email.headers as Record<string, string> | null
    const replyToRaw = headers?.['reply-to']
    let replyTo: string | null = null
    if (replyToRaw) {
      try {
        const parsed = JSON.parse(replyToRaw)
        if (parsed && typeof parsed === 'object') {
          if (parsed.text) {
            replyTo = parsed.text
          } else if (Array.isArray(parsed.value)) {
            replyTo = parsed.value
              .map((v: { name?: string; address?: string }) =>
                v.name ? `${v.name} <${v.address}>` : v.address
              )
              .filter(Boolean)
              .join(', ')
          }
        }
      } catch {
        replyTo = replyToRaw
      }
    }

    return {
      id: email.id,
      subject: email.subject,
      content,
      contentText: email.contentText,
      contentHtml: email.contentHtml,
      sentAt: email.sentAt,
      receivedAt: email.receivedAt,
      isRead: !!email.readAt,
      status: email.status,
      sender: sender ? { id: sender.id, name: sender.name, email: sender.email, isMe: sender.isMe } : null,
      recipients,
      attachments: emailAttachments,
      replyTo,
      headers,
      messageId: email.messageId,
      references: email.references,
      inReplyTo: email.inReplyTo,
      queuedAt: email.queuedAt,
      sendAttempts: email.sendAttempts,
      lastSendError: email.lastSendError,
    }
  })

  // Mark unread emails as read (unless markRead=false)
  if (markRead) {
    db.update(emails)
      .set({ readAt: new Date() })
      .where(and(eq(emails.threadId, id), isNull(emails.readAt)))
      .run()
  }

  // Find default "from" identity
  let defaultFromId: number | null = null
  for (const email of emailsWithParticipants) {
    if (email.sender?.isMe) {
      defaultFromId = email.sender.id
      break
    }
    const meRecipient = email.recipients.find(r => r.isMe)
    if (meRecipient) {
      defaultFromId = meRecipient.id
      break
    }
  }

  return c.json({
    id: thread.id,
    subject: thread.subject,
    createdAt: thread.createdAt,
    replyLaterAt: thread.replyLaterAt,
    setAsideAt: thread.setAsideAt,
    emails: emailsWithParticipants,
    defaultFromId,
  })
})

// PATCH /api/threads/:id/reply-later
threadsRoutes.patch('/:id/reply-later', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid thread ID' }, 400)
  }

  const body = await c.req.json()
  const replyLater = body?.replyLater
  const deleteDrafts = body?.deleteDrafts === true

  if (typeof replyLater !== 'boolean') {
    return c.json({ error: 'replyLater must be a boolean' }, 400)
  }

  if (!replyLater) {
    const drafts = db.select({ id: emails.id })
      .from(emails)
      .where(and(eq(emails.threadId, id), eq(emails.status, 'draft')))
      .all()

    if (drafts.length > 0 && !deleteDrafts) {
      return c.json({
        success: false,
        requiresConfirmation: true,
        draftCount: drafts.length,
        message: `This thread has ${drafts.length} draft${drafts.length > 1 ? 's' : ''}. Removing from Reply Later will delete them.`
      })
    }

    if (drafts.length > 0 && deleteDrafts) {
      const draftIds = drafts.map(d => d.id)
      db.delete(emailContacts).where(inArray(emailContacts.emailId, draftIds)).run()
      db.delete(attachments).where(inArray(attachments.emailId, draftIds)).run()
      db.delete(emails).where(inArray(emails.id, draftIds)).run()
    }
  }

  const replyLaterAt = replyLater ? new Date() : null
  db.update(emailThreads)
    .set({ replyLaterAt })
    .where(eq(emailThreads.id, id))
    .run()

  return c.json({ success: true, replyLater, replyLaterAt })
})

// PATCH /api/threads/:id/set-aside
threadsRoutes.patch('/:id/set-aside', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid thread ID' }, 400)
  }

  const body = await c.req.json()
  const setAside = body?.setAside

  if (typeof setAside !== 'boolean') {
    return c.json({ error: 'setAside must be a boolean' }, 400)
  }

  const setAsideAt = setAside ? new Date() : null
  db.update(emailThreads)
    .set({ setAsideAt })
    .where(eq(emailThreads.id, id))
    .run()

  return c.json({ success: true, setAside, setAsideAt })
})

// POST /api/threads/:id/trash
// Move thread to Trash folder
threadsRoutes.post('/:id/trash', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid thread ID' }, 400)
  }

  const thread = db.select({ folderId: emailThreads.folderId })
    .from(emailThreads)
    .where(eq(emailThreads.id, id))
    .get()

  if (!thread) {
    return c.json({ error: 'Thread not found' }, 404)
  }

  const TRASH_FOLDER_ID = 3
  const now = new Date()

  // Store previous folder for restore and move to Trash
  db.update(emailThreads)
    .set({
      previousFolderId: thread.folderId,
      folderId: TRASH_FOLDER_ID,
      trashedAt: now,
      updatedAt: now,
    })
    .where(eq(emailThreads.id, id))
    .run()

  return c.json({ success: true, trashedAt: now })
})

// POST /api/threads/:id/restore
// Restore thread from Trash to its previous folder
threadsRoutes.post('/:id/restore', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid thread ID' }, 400)
  }

  const thread = db.select({
    folderId: emailThreads.folderId,
    previousFolderId: emailThreads.previousFolderId,
    trashedAt: emailThreads.trashedAt,
  })
    .from(emailThreads)
    .where(eq(emailThreads.id, id))
    .get()

  if (!thread) {
    return c.json({ error: 'Thread not found' }, 404)
  }

  const TRASH_FOLDER_ID = 3
  if (thread.folderId !== TRASH_FOLDER_ID) {
    return c.json({ error: 'Thread is not in Trash' }, 400)
  }

  const now = new Date()
  const restoreFolderId = thread.previousFolderId || 1 // Default to Inbox if no previous folder

  db.update(emailThreads)
    .set({
      folderId: restoreFolderId,
      previousFolderId: null,
      trashedAt: null,
      updatedAt: now,
    })
    .where(eq(emailThreads.id, id))
    .run()

  return c.json({ success: true, folderId: restoreFolderId })
})

// DELETE /api/threads/:id
// Permanently delete a trashed thread
threadsRoutes.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid thread ID' }, 400)
  }

  const thread = db.select({
    folderId: emailThreads.folderId,
    trashedAt: emailThreads.trashedAt,
  })
    .from(emailThreads)
    .where(eq(emailThreads.id, id))
    .get()

  if (!thread) {
    return c.json({ error: 'Thread not found' }, 404)
  }

  const TRASH_FOLDER_ID = 3
  if (thread.folderId !== TRASH_FOLDER_ID) {
    return c.json({ error: 'Can only permanently delete threads in Trash' }, 400)
  }

  // Get all emails in this thread
  const threadEmails = db.select({ id: emails.id })
    .from(emails)
    .where(eq(emails.threadId, id))
    .all()

  const emailIds = threadEmails.map(e => e.id)

  if (emailIds.length > 0) {
    // Get and delete attachment files
    const threadAttachments = db.select({ filePath: attachments.filePath })
      .from(attachments)
      .where(inArray(attachments.emailId, emailIds))
      .all()

    const { existsSync, unlinkSync } = await import('fs')
    for (const attachment of threadAttachments) {
      try {
        if (existsSync(attachment.filePath)) {
          unlinkSync(attachment.filePath)
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
  db.delete(emailThreadContacts).where(eq(emailThreadContacts.threadId, id)).run()

  // Delete emails
  db.delete(emails).where(eq(emails.threadId, id)).run()

  // Delete thread
  db.delete(emailThreads).where(eq(emailThreads.id, id)).run()

  return c.json({ success: true })
})
