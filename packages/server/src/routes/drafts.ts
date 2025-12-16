import { Hono } from 'hono'
import { eq, and, inArray } from 'drizzle-orm'
import { db, emails, emailContacts, emailThreadContacts, contacts, attachments } from '@meremail/shared'

export const draftsRoutes = new Hono()

interface Recipient {
  id?: number
  email: string
  name?: string
  role: 'to' | 'cc' | 'bcc'
}

interface DraftBody {
  threadId?: number
  senderId: number
  subject?: string
  contentText?: string
  contentHtml?: string
  inReplyTo?: string
  references?: string[]
  recipients?: Recipient[]
}

// POST /api/drafts/check - Check which draft IDs still exist
// Must be defined before /:id to avoid route parameter conflicts
draftsRoutes.post('/check', async (c) => {
  const body = await c.req.json<{ ids: number[] }>()

  if (!body.ids || !Array.isArray(body.ids)) {
    return c.json({ error: 'Missing required field: ids (array)' }, 400)
  }

  if (body.ids.length === 0) {
    return c.json({ existing: [] })
  }

  // Find which of the provided IDs exist as drafts
  const existingDrafts = db
    .select({ id: emails.id })
    .from(emails)
    .where(and(
      inArray(emails.id, body.ids),
      eq(emails.status, 'draft')
    ))
    .all()

  return c.json({
    existing: existingDrafts.map(d => d.id)
  })
})

// POST /api/drafts
draftsRoutes.post('/', async (c) => {
  const body = await c.req.json<DraftBody>()

  if (!body.senderId) {
    return c.json({ error: 'Missing required field: senderId' }, 400)
  }

  const threadId = body.threadId || null

  const result = db
    .insert(emails)
    .values({
      threadId,
      senderId: body.senderId,
      subject: body.subject || '',
      contentText: body.contentText || '',
      contentHtml: body.contentHtml || null,
      inReplyTo: body.inReplyTo || null,
      references: body.references || null,
      status: 'draft',
      folder: 'Drafts',
      readAt: new Date(),
    })
    .returning({ id: emails.id })
    .get()

  const emailId = result.id

  const recipients = body.recipients || []
  for (const recipient of recipients) {
    if (recipient.id) {
      db.insert(emailContacts)
        .values({
          emailId,
          contactId: recipient.id,
          role: recipient.role,
        })
        .onConflictDoNothing()
        .run()
    }
  }

  db.insert(emailContacts)
    .values({
      emailId,
      contactId: body.senderId,
      role: 'from',
    })
    .onConflictDoNothing()
    .run()

  if (threadId) {
    const allContactIds = new Set<number>([body.senderId])
    for (const r of recipients) {
      if (r.id) allContactIds.add(r.id)
    }

    for (const contactId of allContactIds) {
      db.insert(emailThreadContacts)
        .values({
          threadId,
          contactId,
          role: contactId === body.senderId ? 'sender' : 'recipient',
        })
        .onConflictDoNothing()
        .run()
    }
  }

  return c.json({ id: emailId, threadId, status: 'draft' })
})

// GET /api/drafts/:id
draftsRoutes.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid draft ID' }, 400)
  }

  const draft = db
    .select({
      id: emails.id,
      subject: emails.subject,
      contentText: emails.contentText,
      contentHtml: emails.contentHtml,
      senderId: emails.senderId,
      status: emails.status,
      threadId: emails.threadId,
    })
    .from(emails)
    .where(and(eq(emails.id, id), eq(emails.status, 'draft')))
    .get()

  if (!draft) {
    return c.json({ error: 'Draft not found' }, 404)
  }

  const sender = db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
    })
    .from(contacts)
    .where(eq(contacts.id, draft.senderId))
    .get()

  const recipientsData = db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
      role: emailContacts.role,
    })
    .from(emailContacts)
    .innerJoin(contacts, eq(contacts.id, emailContacts.contactId))
    .where(eq(emailContacts.emailId, id))
    .all()
    .filter(r => r.role !== 'from')

  const attachmentsData = db
    .select({
      id: attachments.id,
      filename: attachments.filename,
      mimeType: attachments.mimeType,
      size: attachments.size,
      isInline: attachments.isInline,
    })
    .from(attachments)
    .where(eq(attachments.emailId, id))
    .all()

  return c.json({
    id: draft.id,
    subject: draft.subject,
    contentText: draft.contentText,
    contentHtml: draft.contentHtml,
    threadId: draft.threadId,
    sender: sender || null,
    recipients: recipientsData.map(r => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
    })),
    attachments: attachmentsData.map(a => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      isInline: a.isInline,
    })),
  })
})

// PATCH /api/drafts/:id
draftsRoutes.patch('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid draft ID' }, 400)
  }

  const draft = db
    .select({ id: emails.id, threadId: emails.threadId })
    .from(emails)
    .where(and(eq(emails.id, id), eq(emails.status, 'draft')))
    .get()

  if (!draft) {
    return c.json({ error: 'Draft not found' }, 404)
  }

  const body = await c.req.json<Partial<DraftBody>>()

  const updateData: any = {}
  if (body.subject !== undefined) updateData.subject = body.subject
  if (body.contentText !== undefined) updateData.contentText = body.contentText
  if (body.contentHtml !== undefined) updateData.contentHtml = body.contentHtml
  if (body.senderId !== undefined) updateData.senderId = body.senderId

  if (Object.keys(updateData).length > 0) {
    db.update(emails)
      .set(updateData)
      .where(eq(emails.id, id))
      .run()
  }

  // Update recipients if provided
  if (body.recipients !== undefined) {
    // Remove existing recipients (except 'from')
    db.delete(emailContacts)
      .where(and(
        eq(emailContacts.emailId, id),
        // Using raw SQL because drizzle doesn't support ne directly in this context
      ))
      .run()

    // Re-add sender as 'from'
    const senderId = body.senderId || draft.threadId
    if (senderId) {
      db.insert(emailContacts)
        .values({ emailId: id, contactId: senderId, role: 'from' })
        .onConflictDoNothing()
        .run()
    }

    // Add new recipients
    for (const recipient of body.recipients) {
      if (recipient.id) {
        db.insert(emailContacts)
          .values({
            emailId: id,
            contactId: recipient.id,
            role: recipient.role,
          })
          .onConflictDoNothing()
          .run()
      }
    }
  }

  return c.json({ success: true, id })
})

// DELETE /api/drafts/:id
draftsRoutes.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid draft ID' }, 400)
  }

  const draft = db
    .select({ id: emails.id })
    .from(emails)
    .where(and(eq(emails.id, id), eq(emails.status, 'draft')))
    .get()

  if (!draft) {
    return c.json({ error: 'Draft not found' }, 404)
  }

  // Delete attachments
  db.delete(attachments).where(eq(attachments.emailId, id)).run()

  // Delete email contacts
  db.delete(emailContacts).where(eq(emailContacts.emailId, id)).run()

  // Delete the draft
  db.delete(emails).where(eq(emails.id, id)).run()

  return c.json({ success: true })
})

// POST /api/drafts/:id/send - Queue a draft for sending
draftsRoutes.post('/:id/send', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Invalid draft ID' }, 400)
  }

  // Verify draft exists and is in 'draft' status
  const draft = db
    .select({ id: emails.id, status: emails.status })
    .from(emails)
    .where(eq(emails.id, id))
    .get()

  if (!draft) {
    return c.json({ error: 'Draft not found' }, 404)
  }

  if (draft.status !== 'draft') {
    return c.json({ error: 'Email is not a draft' }, 400)
  }

  // Verify draft has at least one recipient
  const recipients = db
    .select({ emailId: emailContacts.emailId })
    .from(emailContacts)
    .where(and(
      eq(emailContacts.emailId, id),
      inArray(emailContacts.role, ['to', 'cc', 'bcc'])
    ))
    .all()

  if (recipients.length === 0) {
    return c.json({ error: 'No recipients specified' }, 400)
  }

  // Transition to 'queued' status
  db.update(emails)
    .set({
      status: 'queued',
      queuedAt: new Date(),
      sendAttempts: 0,
      lastSendError: null,
      lastSendAttemptAt: null,
    })
    .where(eq(emails.id, id))
    .run()

  return c.json({ success: true, status: 'queued' })
})
