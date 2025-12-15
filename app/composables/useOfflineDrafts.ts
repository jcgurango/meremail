import {
  getOfflineDb,
  generateLocalId,
  createCRDTField,
  mergeCRDTField,
  type OfflineDraft,
  type OfflineRecipient,
  type OfflineAttachment,
  type CRDTField,
} from '~/utils/offline-db'
import { useOffline } from './useOffline'
import { useOfflineDb } from './useOfflineDb'

interface DraftData {
  threadId?: number
  senderId: number
  subject: string
  contentText: string
  contentHtml?: string | null
  recipients: OfflineRecipient[]
}

interface ServerDraft {
  id: number
  threadId?: number
  subject: string
  contentText: string
  contentHtml?: string | null
  recipients: Array<{ id: number; email: string; name: string | null; role: string }>
}

/**
 * Create a new offline draft.
 */
export async function createOfflineDraft(data: DraftData): Promise<string> {
  const db = getOfflineDb()
  const now = Date.now()

  const draft: OfflineDraft = {
    localId: generateLocalId(),
    threadId: data.threadId,
    senderId: data.senderId,
    subject: createCRDTField(data.subject),
    contentText: createCRDTField(data.contentText),
    contentHtml: createCRDTField(data.contentHtml ?? null),
    recipients: createCRDTField(data.recipients),
    attachments: [],
    createdAt: now,
  }

  await db.drafts.put(draft)
  updatePendingCount()

  return draft.localId
}

/**
 * Update an existing offline draft.
 */
export async function updateOfflineDraft(
  localId: string,
  data: Partial<DraftData>
): Promise<void> {
  const db = getOfflineDb()
  const draft = await db.drafts.get(localId)
  if (!draft) {
    console.warn(`[Offline] Draft not found: ${localId}`)
    return
  }

  const now = Date.now()

  if (data.subject !== undefined) {
    draft.subject = { value: data.subject, updatedAt: now }
  }
  if (data.contentText !== undefined) {
    draft.contentText = { value: data.contentText, updatedAt: now }
  }
  if (data.contentHtml !== undefined) {
    draft.contentHtml = { value: data.contentHtml ?? null, updatedAt: now }
  }
  if (data.recipients !== undefined) {
    draft.recipients = { value: data.recipients, updatedAt: now }
  }
  if (data.threadId !== undefined) {
    draft.threadId = data.threadId
  }
  if (data.senderId !== undefined) {
    draft.senderId = data.senderId
  }

  // Clear syncedAt to mark as needing sync
  draft.syncedAt = undefined

  await db.drafts.put(draft)
  updatePendingCount()
}

/**
 * Delete an offline draft.
 */
export async function deleteOfflineDraft(localId: string): Promise<void> {
  const db = getOfflineDb()
  const { deleteAttachmentBlob } = useOfflineDb()

  const draft = await db.drafts.get(localId)
  if (draft) {
    // Delete associated attachment blobs
    for (const att of draft.attachments) {
      if (att.blobKey) {
        await deleteAttachmentBlob(Number(att.blobKey))
      }
    }
  }

  await db.drafts.delete(localId)
  updatePendingCount()
}

/**
 * Get an offline draft by localId.
 */
export async function getOfflineDraft(localId: string): Promise<OfflineDraft | undefined> {
  const db = getOfflineDb()
  return db.drafts.get(localId)
}

/**
 * Get an offline draft by serverId.
 */
export async function getOfflineDraftByServerId(serverId: number): Promise<OfflineDraft | undefined> {
  const db = getOfflineDb()
  return db.drafts.where('serverId').equals(serverId).first()
}

/**
 * Get all drafts that need syncing.
 */
export async function getPendingDrafts(): Promise<OfflineDraft[]> {
  const db = getOfflineDb()
  // Drafts without syncedAt or where syncedAt < any field's updatedAt
  return db.drafts
    .filter(d => !d.syncedAt || needsSync(d))
    .toArray()
}

function needsSync(draft: OfflineDraft): boolean {
  if (!draft.syncedAt) return true
  const syncedAt = draft.syncedAt
  return (
    draft.subject.updatedAt > syncedAt ||
    draft.contentText.updatedAt > syncedAt ||
    draft.contentHtml.updatedAt > syncedAt ||
    draft.recipients.updatedAt > syncedAt
  )
}

/**
 * Sync all pending drafts to server using CRDT merge.
 */
export async function syncPendingDrafts(): Promise<void> {
  const { isOnline, setPendingSyncCount } = useOffline()
  if (!isOnline.value) return

  const db = getOfflineDb()
  const pendingDrafts = await getPendingDrafts()

  console.log(`[Offline] Syncing ${pendingDrafts.length} pending drafts`)

  for (const draft of pendingDrafts) {
    try {
      await syncDraft(draft)
    } catch (e) {
      console.error(`[Offline] Failed to sync draft ${draft.localId}:`, e)
    }
  }

  updatePendingCount()
}

async function syncDraft(draft: OfflineDraft): Promise<void> {
  const db = getOfflineDb()
  const now = Date.now()

  if (draft.serverId) {
    // Existing draft - fetch server version and merge
    try {
      const serverDraft = await $fetch<ServerDraft>(`/api/drafts/${draft.serverId}`)
      const merged = mergeDraft(draft, serverDraft)

      // Update server with merged data
      await $fetch(`/api/drafts/${draft.serverId}`, {
        method: 'PATCH',
        body: {
          subject: merged.subject.value,
          contentText: merged.contentText.value,
          contentHtml: merged.contentHtml.value,
          recipients: merged.recipients.value.map(r => ({
            id: r.id,
            email: r.email,
            name: r.name,
            role: r.role,
          })),
        },
      })

      // Update local with merged data and mark as synced
      merged.syncedAt = now
      await db.drafts.put(merged)
    } catch (e: any) {
      if (e?.statusCode === 404) {
        // Draft was deleted on server - recreate or delete local
        console.log(`[Offline] Server draft ${draft.serverId} not found, creating new`)
        draft.serverId = undefined
        await createDraftOnServer(draft)
      } else {
        throw e
      }
    }
  } else {
    // New draft - create on server
    await createDraftOnServer(draft)
  }
}

async function createDraftOnServer(draft: OfflineDraft): Promise<void> {
  const db = getOfflineDb()

  const result = await $fetch<{ id: number }>('/api/drafts', {
    method: 'POST',
    body: {
      threadId: draft.threadId,
      senderId: draft.senderId,
      subject: draft.subject.value,
      contentText: draft.contentText.value,
      contentHtml: draft.contentHtml.value,
      recipients: draft.recipients.value.map(r => ({
        id: r.id,
        email: r.email,
        name: r.name,
        role: r.role,
      })),
    },
  })

  draft.serverId = result.id
  draft.syncedAt = Date.now()
  await db.drafts.put(draft)

  console.log(`[Offline] Created server draft ${result.id} for local ${draft.localId}`)
}

/**
 * CRDT merge: latest timestamp wins for each field.
 */
function mergeDraft(local: OfflineDraft, server: ServerDraft): OfflineDraft {
  // Create CRDT fields from server data with assumed timestamp
  // Server is source of truth if no local changes since sync
  const serverTimestamp = local.syncedAt || 0

  const serverSubject: CRDTField<string> = {
    value: server.subject,
    updatedAt: serverTimestamp,
  }
  const serverContentText: CRDTField<string> = {
    value: server.contentText,
    updatedAt: serverTimestamp,
  }
  const serverContentHtml: CRDTField<string | null> = {
    value: server.contentHtml ?? null,
    updatedAt: serverTimestamp,
  }
  const serverRecipients: CRDTField<OfflineRecipient[]> = {
    value: server.recipients.map(r => ({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role as 'to' | 'cc' | 'bcc',
    })),
    updatedAt: serverTimestamp,
  }

  return {
    ...local,
    serverId: server.id,
    threadId: server.threadId ?? local.threadId,
    subject: mergeCRDTField(local.subject, serverSubject),
    contentText: mergeCRDTField(local.contentText, serverContentText),
    contentHtml: mergeCRDTField(local.contentHtml, serverContentHtml),
    recipients: mergeCRDTField(local.recipients, serverRecipients),
  }
}

/**
 * Update pending sync count in global state.
 */
async function updatePendingCount(): Promise<void> {
  const { setPendingSyncCount } = useOffline()
  const pending = await getPendingDrafts()
  setPendingSyncCount(pending.length)
}

/**
 * Add attachment to offline draft.
 */
export async function addOfflineAttachment(
  localDraftId: string,
  attachment: Omit<OfflineAttachment, 'localId'>
): Promise<string> {
  const db = getOfflineDb()
  const draft = await db.drafts.get(localDraftId)
  if (!draft) {
    throw new Error(`Draft not found: ${localDraftId}`)
  }

  const att: OfflineAttachment = {
    ...attachment,
    localId: generateLocalId(),
  }

  draft.attachments.push(att)
  draft.syncedAt = undefined  // Mark as needing sync
  await db.drafts.put(draft)
  updatePendingCount()

  return att.localId
}

/**
 * Remove attachment from offline draft.
 */
export async function removeOfflineAttachment(
  localDraftId: string,
  attachmentLocalId: string
): Promise<void> {
  const db = getOfflineDb()
  const { deleteAttachmentBlob } = useOfflineDb()

  const draft = await db.drafts.get(localDraftId)
  if (!draft) return

  const attIndex = draft.attachments.findIndex(a => a.localId === attachmentLocalId)
  if (attIndex === -1) return

  const att = draft.attachments[attIndex]
  if (att && att.blobKey) {
    await deleteAttachmentBlob(Number(att.blobKey))
  }

  draft.attachments.splice(attIndex, 1)
  draft.syncedAt = undefined
  await db.drafts.put(draft)
  updatePendingCount()
}

/**
 * Composable for reactive draft operations.
 */
export function useOfflineDrafts() {
  const { isOnline } = useOffline()

  return {
    createDraft: createOfflineDraft,
    updateDraft: updateOfflineDraft,
    deleteDraft: deleteOfflineDraft,
    getDraft: getOfflineDraft,
    getDraftByServerId: getOfflineDraftByServerId,
    getPending: getPendingDrafts,
    syncAll: syncPendingDrafts,
    addAttachment: addOfflineAttachment,
    removeAttachment: removeOfflineAttachment,
    isOnline,
  }
}
