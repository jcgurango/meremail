import { TRASH_FOLDER_ID, INBOX_FOLDER_ID } from '@meremail/shared/sync-types'
import type { SyncDraftInput } from '@meremail/shared/sync-types'
import { db, type LocalAction, type PendingAction, type LocalDraft } from './db'
import { recomputeThreads } from './store'
import { deleteFiles, attachmentKey, draftAttachmentKey } from './files'
import { uuid } from './uuid'

/**
 * The pending-actions queue.
 *
 * Every change the user makes is applied to the local database straight away
 * and queued here; the sync engine sends the queue to the server in order.
 */

type ActionOf<T extends LocalAction['type']> = Extract<LocalAction, { type: T }>
type ActionInput = { [T in LocalAction['type']]: Pick<ActionOf<T>, 'type' | 'payload'> }[LocalAction['type']]

// IDs of actions currently being sent. These can no longer be edited or withdrawn.
export const inFlight = new Set<string>()

let onEnqueue: (() => void) | null = null

/** Called by the sync engine so that queuing an action starts a sync */
export function setEnqueueListener(listener: () => void): void {
  onEnqueue = listener
}

// ============== Local effects ==============

async function markEmailsRead(emailIds: number[], at: number): Promise<void> {
  const threadIds = new Set<number>()
  for (const email of await db.emails.bulkGet(emailIds)) {
    if (!email || !email.unread) continue
    await db.emails.update(email.id, { unread: 0, readAt: at })
    threadIds.add(email.threadId)
  }
  await recomputeThreads(threadIds)
}

async function deleteThreadLocally(threadId: number): Promise<string[]> {
  const emails = await db.emails.where('threadId').equals(threadId).toArray()
  await db.emails.bulkDelete(emails.map(e => e.id))
  await db.threads.delete(threadId)
  return emails.flatMap(e => e.attachments.map(a => attachmentKey(a.id)))
}

async function moveThreadLocally(threadId: number, folderId: number, at: number): Promise<void> {
  const thread = await db.threads.get(threadId)
  if (!thread) return

  if (folderId === TRASH_FOLDER_ID) {
    if (thread.folderId === TRASH_FOLDER_ID) return
    await db.threads.update(threadId, { previousFolderId: thread.folderId, folderId, trashedAt: at })
  } else {
    await db.threads.update(threadId, { folderId, previousFolderId: null, trashedAt: null })
  }
}

function draftFromInput(input: SyncDraftInput, existing: LocalDraft | undefined, at: number): LocalDraft {
  return {
    ...input,
    attachments: existing?.attachments ?? [],
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    sending: existing?.sending,
  }
}

/**
 * Apply an action's effect to the local database. Returns files that are no
 * longer needed.
 *
 * This runs when the action is queued, and again whenever server data
 * overwrites local rows while the action is still waiting - so it must be
 * safe to repeat, and must cope with its target no longer existing.
 */
async function applyLocal(action: PendingAction): Promise<string[]> {
  const at = action.createdAt

  switch (action.type) {
    case 'thread.move':
      await moveThreadLocally(action.payload.threadId, action.payload.folderId, at)
      return []

    case 'thread.trash':
      await moveThreadLocally(action.payload.threadId, TRASH_FOLDER_ID, at)
      return []

    case 'thread.restore': {
      const thread = await db.threads.get(action.payload.threadId)
      if (thread?.folderId === TRASH_FOLDER_ID) {
        await moveThreadLocally(thread.id, thread.previousFolderId ?? INBOX_FOLDER_ID, at)
      }
      return []
    }

    case 'thread.delete':
      return deleteThreadLocally(action.payload.threadId)

    case 'thread.replyLater':
      await db.threads.update(action.payload.threadId, { replyLaterAt: action.payload.value ? at : null })
      return []

    case 'thread.setAside':
      await db.threads.update(action.payload.threadId, { setAsideAt: action.payload.value ? at : null })
      return []

    case 'emails.markRead':
      await markEmailsRead(action.payload.emailIds, at)
      return []

    case 'folder.markAllRead': {
      const threads = await db.threads.where('folderId').equals(action.payload.folderId).toArray()
      for (const thread of threads.filter(t => t.unreadCount > 0)) {
        const emails = await db.emails.where('threadId').equals(thread.id).toArray()
        await markEmailsRead(emails.map(e => e.id), at)
      }
      return []
    }

    case 'email.delete': {
      const email = await db.emails.get(action.payload.emailId)
      if (!email) return []
      await db.emails.delete(email.id)
      const files = email.attachments.map(a => attachmentKey(a.id))
      if (await db.emails.where('threadId').equals(email.threadId).count() === 0) {
        files.push(...await deleteThreadLocally(email.threadId))
      } else {
        await recomputeThreads([email.threadId])
      }
      return files
    }

    case 'draft.save': {
      const existing = await db.drafts.get(action.payload.draft.id)
      await db.drafts.put(draftFromInput(action.payload.draft, existing, at))
      return []
    }

    case 'draft.delete': {
      const draft = await db.drafts.get(action.payload.draftId)
      await db.drafts.delete(action.payload.draftId)
      return draft ? draft.attachments.map(a => draftAttachmentKey(a.id)) : []
    }

    case 'draft.upload': {
      const { draftId, attachmentId, filename, mimeType, size, isInline } = action.payload
      const draft = await db.drafts.get(draftId)
      if (!draft) return []
      const others = draft.attachments.filter(a => a.id !== attachmentId)
      await db.drafts.update(draftId, {
        attachments: [...others, { id: attachmentId, filename, mimeType, size, isInline, pending: true }],
      })
      return []
    }

    case 'draft.removeAttachment': {
      const draft = await db.drafts.get(action.payload.draftId)
      if (draft) {
        await db.drafts.update(draft.id, {
          attachments: draft.attachments.filter(a => a.id !== action.payload.attachmentId),
        })
      }
      return [draftAttachmentKey(action.payload.attachmentId)]
    }

    case 'draft.send': {
      const existing = await db.drafts.get(action.payload.draft.id)
      // The draft stays, marked as sending, until the server replaces it with the real email
      await db.drafts.put({ ...draftFromInput(action.payload.draft, existing, at), sending: true })
      return []
    }
  }
}

const ACTION_TABLES = [db.threads, db.emails, db.drafts, db.actions]

// ============== Queue ==============

/**
 * Apply an action locally and queue it for the server
 */
export async function enqueue(input: ActionInput): Promise<void> {
  const action = { ...input, id: uuid(), createdAt: Date.now(), attempts: 0 } as PendingAction

  const files = await db.transaction('rw', ACTION_TABLES, async () => {
    const removed = await applyLocal(action)
    await db.actions.add(action)
    return removed
  })

  await deleteFiles(files)
  onEnqueue?.()
}

/**
 * Re-apply the effects of everything still queued. Called after server data
 * has been written, so that changes not yet sent aren't visibly undone.
 */
export async function reapplyPending(): Promise<void> {
  if (await db.actions.count() === 0) return

  await db.transaction('rw', ACTION_TABLES, async () => {
    for (const action of await db.actions.orderBy('seq').toArray()) {
      await applyLocal(action)
    }
  })
}

function isDraftAction(action: PendingAction, draftId: string): boolean {
  switch (action.type) {
    case 'draft.save':
    case 'draft.send':
      return action.payload.draft.id === draftId
    case 'draft.delete':
    case 'draft.upload':
    case 'draft.removeAttachment':
      return action.payload.draftId === draftId
    default:
      return false
  }
}

/**
 * Save a draft. Repeated saves of the same draft collapse into one queued
 * action, so typing doesn't build up a backlog.
 */
export async function saveDraft(draft: SyncDraftInput): Promise<void> {
  const replaced = await db.transaction('rw', ACTION_TABLES, async () => {
    const queued = await db.actions.orderBy('seq').toArray()
    const last = queued.filter(a => isDraftAction(a, draft.id)).pop()

    if (last?.type !== 'draft.save' || inFlight.has(last.id)) return false

    const updated = { ...last, payload: { draft }, createdAt: Date.now() } as PendingAction
    await db.actions.put(updated)
    await applyLocal(updated)
    return true
  })

  if (replaced) {
    onEnqueue?.()
  } else {
    await enqueue({ type: 'draft.save', payload: { draft } })
  }
}

/**
 * Queue a draft for sending. The send carries the final content itself, so
 * saves still waiting in the queue are no longer needed.
 */
export async function sendDraft(draft: SyncDraftInput, messageId: string): Promise<void> {
  await db.transaction('rw', ACTION_TABLES, async () => {
    const queued = await db.actions.toArray()
    const superseded = queued.filter(a => a.type === 'draft.save' && isDraftAction(a, draft.id) && !inFlight.has(a.id))
    await db.actions.bulkDelete(superseded.map(a => a.seq!))
  })

  await enqueue({ type: 'draft.send', payload: { draft, messageId } })
}

/**
 * Discard a draft, along with anything still queued for it
 */
export async function discardDraft(draftId: string): Promise<void> {
  await db.transaction('rw', ACTION_TABLES, async () => {
    const queued = await db.actions.toArray()
    const withdrawn = queued.filter(a => isDraftAction(a, draftId) && !inFlight.has(a.id))
    await db.actions.bulkDelete(withdrawn.map(a => a.seq!))
  })

  // The server may or may not have heard of this draft; deleting is harmless either way
  await enqueue({ type: 'draft.delete', payload: { draftId } })
}

/**
 * Remove an attachment from a draft. If its upload hasn't started yet, the
 * upload is simply withdrawn.
 */
export async function removeDraftAttachment(draftId: string, attachmentId: string): Promise<void> {
  const withdrawn = await db.transaction('rw', ACTION_TABLES, async () => {
    const queued = await db.actions.toArray()
    const upload = queued.find(a => a.type === 'draft.upload' && a.payload.attachmentId === attachmentId)
    if (!upload || inFlight.has(upload.id)) return false

    await db.actions.delete(upload.seq!)
    const draft = await db.drafts.get(draftId)
    if (draft) {
      await db.drafts.update(draftId, { attachments: draft.attachments.filter(a => a.id !== attachmentId) })
    }
    return true
  })

  if (withdrawn) {
    await deleteFiles([draftAttachmentKey(attachmentId)])
  } else {
    await enqueue({ type: 'draft.removeAttachment', payload: { draftId, attachmentId } })
  }
}

// ============== Describing actions ==============

/**
 * A short description of what an action was acting on, for error messages
 */
export async function describeAction(action: LocalAction): Promise<string> {
  const threadSubject = async (threadId: number) => (await db.threads.get(threadId))?.subject || 'a thread'

  switch (action.type) {
    case 'thread.move':
      return `Move "${await threadSubject(action.payload.threadId)}"`
    case 'thread.trash':
      return `Trash "${await threadSubject(action.payload.threadId)}"`
    case 'thread.restore':
      return `Restore "${await threadSubject(action.payload.threadId)}"`
    case 'thread.delete':
      return 'Delete a thread'
    case 'thread.replyLater':
      return `Reply Later for "${await threadSubject(action.payload.threadId)}"`
    case 'thread.setAside':
      return `Set Aside for "${await threadSubject(action.payload.threadId)}"`
    case 'emails.markRead':
    case 'folder.markAllRead':
      return 'Mark as read'
    case 'email.delete':
      return 'Delete an email'
    case 'draft.save':
      return `Save draft "${action.payload.draft.subject || '(No subject)'}"`
    case 'draft.send':
      return `Send "${action.payload.draft.subject || '(No subject)'}"`
    case 'draft.delete':
      return 'Discard a draft'
    case 'draft.upload':
      return `Upload "${action.payload.filename}"`
    case 'draft.removeAttachment':
      return 'Remove an attachment'
  }
}
