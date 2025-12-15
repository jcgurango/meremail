import { getOfflineDb, CACHE_LIMITS, type OfflineContact } from '~/utils/offline-db'
import { useOfflineDb } from './useOfflineDb'

/**
 * Sync contacts incrementally from server.
 * On first run, fetches all contacts. Subsequently, only fetches new ones.
 */
export async function refreshContactCache(): Promise<void> {
  const db = getOfflineDb()
  const { getCacheMeta, updateCacheMeta } = useOfflineDb()

  try {
    // Get the last sync timestamp
    const meta = await getCacheMeta('contacts')
    const lastSyncedAt = meta?.cachedAt || 0

    // Fetch contacts (all on first run, incremental after)
    const data = await $fetch<{
      contacts: Array<{
        id: number
        name: string | null
        email: string
        bucket: string | null
        isMe: boolean
        createdAt: number
      }>
      syncedAt: number
      hasMore: boolean
    }>('/api/contacts', {
      query: {
        all: 'true',
        limit: '5000',
        ...(lastSyncedAt > 0 ? { createdSince: String(lastSyncedAt) } : {}),
      }
    })

    const now = Date.now()
    const contacts: OfflineContact[] = data.contacts.map(c => ({
      id: c.id,
      name: c.name,
      email: c.email,
      bucket: c.bucket,
      isMe: c.isMe,
      cachedAt: now,
    }))

    if (contacts.length > 0) {
      // Upsert contacts (add new ones, update existing by ID)
      await db.contacts.bulkPut(contacts)
    }

    // Get total count for metadata
    const totalCount = await db.contacts.count()

    // Update cache metadata with the server's syncedAt timestamp
    await updateCacheMeta('contacts', 0, totalCount, 0) // expiresAt=0 means never expires, we sync incrementally

    // Store the syncedAt separately so we can use it for next incremental fetch
    await db.cacheMeta.update('contacts', { cachedAt: data.syncedAt })

    if (lastSyncedAt > 0) {
      console.log(`[Offline] Synced ${contacts.length} new contacts (total: ${totalCount})`)
    } else {
      console.log(`[Offline] Initial sync: cached ${contacts.length} contacts`)
    }
  } catch (e) {
    console.error('[Offline] Failed to sync contacts:', e)
    throw e
  }
}

/**
 * Search cached contacts locally (client-side FTS-like search).
 */
export function searchCachedContacts(query: string): Promise<OfflineContact[]> {
  const db = getOfflineDb()
  const searchTerm = query.toLowerCase().trim()

  if (searchTerm.length < 2) {
    return Promise.resolve([])
  }

  // Search by name or email containing the query
  return db.contacts
    .filter(contact => {
      const nameMatch = contact.name?.toLowerCase().includes(searchTerm) ?? false
      const emailMatch = contact.email.toLowerCase().includes(searchTerm)
      return nameMatch || emailMatch
    })
    .limit(20)
    .toArray()
}

/**
 * Get all cached "me" contacts (sender identities).
 */
export async function getCachedMeContacts(): Promise<OfflineContact[]> {
  const db = getOfflineDb()
  return db.contacts.where('isMe').equals(1).toArray()
}

/**
 * Get a specific contact by ID from cache.
 */
export async function getCachedContact(id: number): Promise<OfflineContact | undefined> {
  const db = getOfflineDb()
  return db.contacts.get(id)
}

/**
 * Get all cached contacts (for autocomplete when offline).
 */
export async function getAllCachedContacts(): Promise<OfflineContact[]> {
  const db = getOfflineDb()
  return db.contacts.toArray()
}

/**
 * Check if contacts cache exists and is not stale.
 */
export async function isContactsCacheValid(): Promise<boolean> {
  const { isCacheStale } = useOfflineDb()
  return !(await isCacheStale('contacts'))
}

/**
 * Composable for reactive contact operations.
 */
export function useOfflineContacts() {
  const cachedContacts = ref<OfflineContact[]>([])
  const isLoading = ref(false)

  async function loadCachedContacts() {
    isLoading.value = true
    try {
      cachedContacts.value = await getAllCachedContacts()
    } finally {
      isLoading.value = false
    }
  }

  async function search(query: string): Promise<OfflineContact[]> {
    return searchCachedContacts(query)
  }

  async function getMeContacts(): Promise<OfflineContact[]> {
    return getCachedMeContacts()
  }

  return {
    cachedContacts,
    isLoading,
    loadCachedContacts,
    search,
    getMeContacts,
    refreshCache: refreshContactCache,
    isValid: isContactsCacheValid,
  }
}
