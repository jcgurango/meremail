import {
  getOfflineDb,
  CACHE_LIMITS,
  type CacheMeta,
} from '@/utils/offline-db'

export function useOfflineDb() {
  const db = getOfflineDb()

  // ============== Cache Size Management ==============

  async function getCacheSize(cacheType: 'setAside' | 'replyLater'): Promise<number> {
    const blobs = await db.attachmentBlobs
      .where('cacheType')
      .equals(cacheType)
      .toArray()
    return blobs.reduce((sum, b) => sum + b.size, 0)
  }

  async function getTotalCacheSize(): Promise<{
    total: number
    setAside: number
    replyLater: number
    draft: number
  }> {
    const blobs = await db.attachmentBlobs.toArray()
    const result = { total: 0, setAside: 0, replyLater: 0, draft: 0 }

    for (const blob of blobs) {
      result[blob.cacheType] += blob.size
      result.total += blob.size
    }

    return result
  }

  async function isWithinSizeLimit(
    cacheType: 'setAside' | 'replyLater',
    additionalBytes: number
  ): Promise<boolean> {
    const currentSize = await getCacheSize(cacheType)
    return currentSize + additionalBytes <= CACHE_LIMITS[cacheType]
  }

  async function evictOldestAttachments(
    cacheType: 'setAside' | 'replyLater',
    neededBytes: number
  ): Promise<void> {
    const blobs = await db.attachmentBlobs
      .where('cacheType')
      .equals(cacheType)
      .sortBy('cachedAt')  // Oldest first

    let freedBytes = 0
    const idsToDelete: number[] = []

    for (const blob of blobs) {
      if (freedBytes >= neededBytes) break
      idsToDelete.push(blob.id)
      freedBytes += blob.size
    }

    if (idsToDelete.length > 0) {
      await db.attachmentBlobs.bulkDelete(idsToDelete)
    }
  }

  // ============== Attachment Blob Operations ==============

  async function cacheAttachmentBlob(
    id: number,
    blob: Blob,
    cacheType: 'setAside' | 'replyLater' | 'draft'
  ): Promise<boolean> {
    // Check size limit for non-draft caches
    if (cacheType !== 'draft') {
      const currentSize = await getCacheSize(cacheType)
      if (currentSize + blob.size > CACHE_LIMITS[cacheType]) {
        // Try to evict oldest
        await evictOldestAttachments(cacheType, blob.size)
        // Re-check
        const newSize = await getCacheSize(cacheType)
        if (newSize + blob.size > CACHE_LIMITS[cacheType]) {
          console.warn(`Cannot cache attachment ${id}: would exceed ${cacheType} size limit`)
          return false
        }
      }
    }

    await db.attachmentBlobs.put({
      id,
      cacheType,
      blob,
      size: blob.size,
      cachedAt: Date.now(),
    })

    return true
  }

  async function getAttachmentBlob(id: number): Promise<Blob | null> {
    const record = await db.attachmentBlobs.get(id)
    return record?.blob ?? null
  }

  async function deleteAttachmentBlob(id: number): Promise<void> {
    await db.attachmentBlobs.delete(id)
  }

  async function deleteAttachmentBlobsForCache(cacheType: 'setAside' | 'replyLater' | 'draft'): Promise<void> {
    await db.attachmentBlobs.where('cacheType').equals(cacheType).delete()
  }

  // ============== Cache Metadata Operations ==============

  async function updateCacheMeta(
    key: string,
    sizeBytes: number,
    itemCount: number,
    expiresInMs?: number
  ): Promise<void> {
    const now = Date.now()
    await db.cacheMeta.put({
      key,
      cachedAt: now,
      expiresAt: expiresInMs ? now + expiresInMs : 0,
      sizeBytes,
      itemCount,
    })
  }

  async function getCacheMeta(key: string): Promise<CacheMeta | undefined> {
    return db.cacheMeta.get(key)
  }

  async function isCacheStale(key: string): Promise<boolean> {
    const meta = await getCacheMeta(key)
    if (!meta) return true
    if (meta.expiresAt === 0) return false
    return Date.now() > meta.expiresAt
  }

  async function clearCache(key: string): Promise<void> {
    switch (key) {
      case 'contacts':
        await db.contacts.clear()
        break
      case 'threads':
        await db.threads.clear()
        break
      case 'setAside':
        await db.cachedThreads.where('cacheType').equals('setAside').delete()
        await deleteAttachmentBlobsForCache('setAside')
        break
      case 'replyLater':
        await db.cachedThreads.where('cacheType').equals('replyLater').delete()
        await deleteAttachmentBlobsForCache('replyLater')
        break
      case 'drafts':
        await db.drafts.clear()
        await deleteAttachmentBlobsForCache('draft')
        break
      default:
        console.warn(`Unknown cache key: ${key}`)
    }
    await db.cacheMeta.delete(key)
  }

  async function clearAllCaches(): Promise<void> {
    await db.contacts.clear()
    await db.threads.clear()
    await db.cachedThreads.clear()
    await db.attachmentBlobs.clear()
    await db.syncQueue.clear()
    await db.cacheMeta.clear()
    // Note: drafts are NOT cleared - they're user data
  }

  // ============== Sync Queue Operations ==============

  async function addToSyncQueue(
    type: 'draft-create' | 'draft-update' | 'draft-delete' | 'attachment-upload',
    payload: unknown
  ): Promise<number> {
    const id = await db.syncQueue.add({
      type,
      payload,
      createdAt: Date.now(),
      retryCount: 0,
    })
    return id as number
  }

  async function getSyncQueueItems() {
    return db.syncQueue.orderBy('createdAt').toArray()
  }

  async function removeSyncQueueItem(id: number): Promise<void> {
    await db.syncQueue.delete(id)
  }

  async function updateSyncQueueItem(
    id: number,
    updates: Partial<{ retryCount: number; lastError: string }>
  ): Promise<void> {
    await db.syncQueue.update(id, updates)
  }

  return {
    db,
    // Size management
    getCacheSize,
    getTotalCacheSize,
    isWithinSizeLimit,
    evictOldestAttachments,
    // Attachment blobs
    cacheAttachmentBlob,
    getAttachmentBlob,
    deleteAttachmentBlob,
    deleteAttachmentBlobsForCache,
    // Cache metadata
    updateCacheMeta,
    getCacheMeta,
    isCacheStale,
    clearCache,
    clearAllCaches,
    // Sync queue
    addToSyncQueue,
    getSyncQueueItems,
    removeSyncQueueItem,
    updateSyncQueueItem,
    // Constants
    CACHE_LIMITS,
  }
}
