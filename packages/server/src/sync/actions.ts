import { eq, and, inArray, isNull, sql } from 'drizzle-orm'
import {
  db,
  sqlite,
  emails,
  emailThreads,
  emailContacts,
  emailThreadContacts,
  contacts,
  attachments,
  folders,
  drafts,
  draftAttachments,
  appliedActions,
  deleteThread,
  deleteEmail,
  deleteDrafts,
  deleteDraftAttachment,
  generateMessageId,
  TRASH_FOLDER_ID,
  INBOX_FOLDER_ID,
} from '@meremail/shared'
import type {
  SyncAction,
  SyncActionPayloads,
  SyncActionResult,
  SyncActionType,
  SyncDraftInput,
  SyncDraftRecipient,
} from '@meremail/shared'

/**
 * Thrown when an action can never succeed (bad input, target gone).
 * The client drops the action instead of retrying it.
 */
class ActionRejected extends Error {}

type Handlers = { [K in SyncActionType]: (payload: SyncActionPayloads[K]) => void }

// ============== Helpers ==============

function requireThread(threadId: number) {
  const thread = db
    .select({ id: emailThreads.id, folderId: emailThreads.folderId, previousFolderId: emailThreads.previousFolderId })
    .from(emailThreads)
    .where(eq(emailThreads.id, threadId))
    .get()

  if (!thread) throw new ActionRejected('Thread not found')
  return thread
}

function moveThread(threadId: number, folderId: number): void {
  const thread = requireThread(threadId)
  const now = new Date()

  if (folderId === TRASH_FOLDER_ID) {
    if (thread.folderId === TRASH_FOLDER_ID) return
    // Remember where it came from so it can be restored
    db.update(emailThreads)
      .set({ previousFolderId: thread.folderId, folderId: TRASH_FOLDER_ID, trashedAt: now, updatedAt: now })
      .where(eq(emailThreads.id, threadId))
      .run()
    return
  }

  db.update(emailThreads)
    .set({ folderId, previousFolderId: null, trashedAt: null, updatedAt: now })
    .where(eq(emailThreads.id, threadId))
    .run()
}

function validateDraft(draft: SyncDraftInput): void {
  if (!draft || typeof draft.id !== 'string' || !draft.id) {
    throw new ActionRejected('Draft is missing an ID')
  }
  if (typeof draft.senderId !== 'number') {
    throw new ActionRejected('Draft is missing a sender')
  }
  if (!Array.isArray(draft.recipients)) {
    throw new ActionRejected('Draft recipients must be an array')
  }
}

function saveDraft(draft: SyncDraftInput): void {
  validateDraft(draft)

  const now = new Date()
  const values = {
    threadId: draft.threadId ?? null,
    senderId: draft.senderId,
    subject: draft.subject || '',
    contentText: draft.contentText || '',
    contentHtml: draft.contentHtml || null,
    inReplyTo: draft.inReplyTo || null,
    forwardedMessageId: draft.forwardedMessageId || null,
    references: draft.references?.length ? draft.references : null,
    recipients: draft.recipients.map(r => ({
      contactId: r.contactId,
      email: r.email,
      name: r.name ?? null,
      role: r.role,
    })),
    updatedAt: now,
  }

  db.insert(drafts)
    .values({ id: draft.id, ...values, createdAt: now })
    .onConflictDoUpdate({ target: drafts.id, set: values })
    .run()
}

/**
 * Resolve a draft recipient to a contact, creating one for a new address
 */
function resolveRecipient(recipient: SyncDraftRecipient): number {
  if (recipient.contactId) {
    const existing = db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, recipient.contactId)).get()
    if (existing) return existing.id
  }

  const email = recipient.email.trim().toLowerCase()
  const byEmail = db.select({ id: contacts.id }).from(contacts).where(eq(contacts.email, email)).get()
  if (byEmail) return byEmail.id

  return db.insert(contacts).values({ email, name: recipient.name }).returning({ id: contacts.id }).get().id
}

const DRAFT_ATTACHMENT_URL = /\/api\/draft-attachments\/([A-Za-z0-9_-]+)/g

/**
 * Turn a draft into a queued email. The send queue picks it up from there.
 */
function sendDraft(draftId: string, requestedMessageId: string): void {
  const draft = db.select().from(drafts).where(eq(drafts.id, draftId)).get()
  if (!draft) throw new ActionRejected('Draft not found')

  const recipients = draft.recipients.filter(r => r.email?.includes('@'))
  if (recipients.length === 0) throw new ActionRejected('No recipients specified')

  const sender = db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, draft.senderId)).get()
  if (!sender) throw new ActionRejected('Sender not found')

  const now = new Date()
  const resolved = recipients.map(r => ({ contactId: resolveRecipient(r), role: r.role }))

  // Reply into the existing thread, or start a new one
  let threadId = draft.threadId
  if (threadId && !db.select({ id: emailThreads.id }).from(emailThreads).where(eq(emailThreads.id, threadId)).get()) {
    threadId = null
  }
  if (!threadId) {
    threadId = db
      .insert(emailThreads)
      .values({ subject: draft.subject || '(No subject)', creatorId: draft.senderId, folderId: INBOX_FOLDER_ID })
      .returning({ id: emailThreads.id })
      .get().id
  }

  // Use the client's Message-ID so it can recognise the email when it comes
  // back through the feed; fall back to our own if it's unusable or taken
  let messageId = /^<[^<>\s]+@[^<>\s]+>$/.test(requestedMessageId || '') ? requestedMessageId : generateMessageId()
  if (db.select({ id: emails.id }).from(emails).where(eq(emails.messageId, messageId)).get()) {
    messageId = generateMessageId()
  }

  // Inline images are referenced by upload URL while drafting; in the sent
  // email they become cid: references to attachments
  const uploads = db.select().from(draftAttachments).where(eq(draftAttachments.draftId, draftId)).all()
  const inlineIds = new Set(uploads.filter(u => u.isInline).map(u => u.id))
  const contentId = (uploadId: string) => `${uploadId}@meremail`
  const contentHtml = draft.contentHtml
    ? draft.contentHtml.replace(DRAFT_ATTACHMENT_URL, (url, id: string) => inlineIds.has(id) ? `cid:${contentId(id)}` : url)
    : null

  const emailId = db
    .insert(emails)
    .values({
      threadId,
      senderId: draft.senderId,
      messageId,
      inReplyTo: draft.inReplyTo,
      forwardedMessageId: draft.forwardedMessageId,
      references: draft.references,
      folder: 'sent',
      readAt: now,
      status: 'queued',
      subject: draft.subject,
      contentText: draft.contentText,
      contentHtml,
      queuedAt: now,
      sendAttempts: 0,
    })
    .returning({ id: emails.id })
    .get().id

  db.insert(emailContacts).values({ emailId, contactId: draft.senderId, role: 'from' }).onConflictDoNothing().run()
  db.insert(emailThreadContacts).values({ threadId, contactId: draft.senderId, role: 'sender' }).onConflictDoNothing().run()
  for (const r of resolved) {
    db.insert(emailContacts).values({ emailId, contactId: r.contactId, role: r.role }).onConflictDoNothing().run()
    db.insert(emailThreadContacts).values({ threadId, contactId: r.contactId, role: 'recipient' }).onConflictDoNothing().run()
  }

  // Uploaded files become the email's attachments
  for (const upload of uploads) {
    db.insert(attachments)
      .values({
        emailId,
        filename: upload.filename,
        mimeType: upload.mimeType,
        size: upload.size,
        filePath: upload.filePath,
        contentId: upload.isInline ? contentId(upload.id) : null,
        isInline: upload.isInline,
      })
      .run()
  }

  // A forward carries the original email's attachments along
  if (draft.forwardedMessageId) {
    const original = db.select({ id: emails.id }).from(emails).where(eq(emails.messageId, draft.forwardedMessageId)).get()
    if (original) {
      const originalAttachments = db.select().from(attachments).where(eq(attachments.emailId, original.id)).all()
      for (const att of originalAttachments) {
        db.insert(attachments)
          .values({
            emailId,
            filename: att.filename,
            mimeType: att.mimeType,
            size: att.size,
            filePath: att.filePath,
            contentId: att.contentId,
            isInline: att.isInline,
          })
          .run()
      }
    }
  }

  // The draft is done - its files now belong to the email, so only drop the records
  db.delete(draftAttachments).where(eq(draftAttachments.draftId, draftId)).run()
  db.delete(drafts).where(eq(drafts.id, draftId)).run()

  // Replying takes the thread out of Reply Later once nothing else is pending
  const remainingDrafts = db.select({ id: drafts.id }).from(drafts).where(eq(drafts.threadId, threadId)).all()
  if (remainingDrafts.length === 0) {
    db.update(emailThreads)
      .set({ replyLaterAt: null })
      .where(and(eq(emailThreads.id, threadId), sql`${emailThreads.replyLaterAt} IS NOT NULL`))
      .run()
  }
}

// ============== Handlers ==============

const handlers: Handlers = {
  'thread.move': ({ threadId, folderId }) => {
    if (typeof folderId !== 'number') throw new ActionRejected('folderId is required')
    const folder = db.select({ id: folders.id }).from(folders).where(eq(folders.id, folderId)).get()
    if (!folder) throw new ActionRejected('Folder not found')
    moveThread(threadId, folderId)
  },

  'thread.trash': ({ threadId }) => {
    moveThread(threadId, TRASH_FOLDER_ID)
  },

  'thread.restore': ({ threadId }) => {
    const thread = requireThread(threadId)
    if (thread.folderId !== TRASH_FOLDER_ID) return
    moveThread(threadId, thread.previousFolderId || INBOX_FOLDER_ID)
  },

  'thread.delete': ({ threadId }) => {
    // Already gone is fine - the client wanted it deleted
    deleteThread(threadId)
  },

  'thread.replyLater': ({ threadId, value }) => {
    requireThread(threadId)
    db.update(emailThreads)
      .set({ replyLaterAt: value ? new Date() : null })
      .where(eq(emailThreads.id, threadId))
      .run()
  },

  'thread.setAside': ({ threadId, value }) => {
    requireThread(threadId)
    db.update(emailThreads)
      .set({ setAsideAt: value ? new Date() : null })
      .where(eq(emailThreads.id, threadId))
      .run()
  },

  'emails.markRead': ({ emailIds }) => {
    if (!Array.isArray(emailIds) || !emailIds.every(id => typeof id === 'number')) {
      throw new ActionRejected('emailIds must be an array of numbers')
    }
    if (emailIds.length === 0) return
    db.update(emails)
      .set({ readAt: new Date() })
      .where(and(inArray(emails.id, emailIds), isNull(emails.readAt)))
      .run()
  },

  'folder.markAllRead': ({ folderId }) => {
    if (typeof folderId !== 'number') throw new ActionRejected('folderId is required')
    db.update(emails)
      .set({ readAt: new Date() })
      .where(and(
        isNull(emails.readAt),
        sql`${emails.threadId} IN (SELECT id FROM email_threads WHERE folder_id = ${folderId})`
      ))
      .run()
  },

  'email.delete': ({ emailId }) => {
    const email = db.select({ threadId: emails.threadId }).from(emails).where(eq(emails.id, emailId)).get()
    if (!email) return

    deleteEmail(emailId)

    // Deleting the last email takes the thread with it
    if (email.threadId) {
      const remaining = db.select({ id: emails.id }).from(emails).where(eq(emails.threadId, email.threadId)).limit(1).get()
      if (!remaining) deleteThread(email.threadId)
    }
  },

  'draft.save': ({ draft }) => {
    saveDraft(draft)
  },

  'draft.delete': ({ draftId }) => {
    deleteDrafts([draftId])
  },

  'draft.removeAttachment': ({ attachmentId }) => {
    deleteDraftAttachment(attachmentId)
  },

  'draft.send': ({ draft, messageId }) => {
    // The action carries the final content, so it doesn't depend on an earlier save having arrived
    saveDraft(draft)
    sendDraft(draft.id, messageId)
  },
}

// ============== Entry point ==============

/**
 * Apply a batch of client actions in order.
 *
 * Each action runs in its own transaction and is recorded by ID, so a batch
 * that is retried after a dropped response is not applied twice.
 */
export function applyActions(actions: SyncAction[]): SyncActionResult[] {
  const results: SyncActionResult[] = []

  for (const action of actions) {
    if (!action || typeof action.id !== 'string' || !action.id) {
      results.push({ id: String(action?.id ?? ''), ok: false, error: 'Action is missing an ID' })
      continue
    }

    const previous = db.select({ result: appliedActions.result }).from(appliedActions).where(eq(appliedActions.id, action.id)).get()
    if (previous) {
      results.push({ id: action.id, ...previous.result })
      continue
    }

    const handler = handlers[action.type] as ((payload: unknown) => void) | undefined
    let result: { ok: boolean; error?: string }

    if (!handler) {
      result = { ok: false, error: `Unknown action type: ${action.type}` }
    } else {
      try {
        sqlite.transaction(() => handler(action.payload ?? {}))()
        result = { ok: true }
      } catch (e) {
        if (!(e instanceof ActionRejected)) {
          // Unexpected failure - leave it unrecorded so it can be retried, and
          // stop here because later actions may depend on this one
          console.error(`[Sync] Action ${action.type} (${action.id}) failed:`, e)
          results.push({ id: action.id, ok: false, error: e instanceof Error ? e.message : 'Unknown error', retry: true })
          break
        }
        result = { ok: false, error: e.message }
      }
    }

    db.insert(appliedActions).values({ id: action.id, result }).onConflictDoNothing().run()
    results.push({ id: action.id, ...result })
  }

  return results
}
