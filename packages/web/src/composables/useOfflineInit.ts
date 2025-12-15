import { useOffline } from './useOffline'
import { useOfflineDb } from './useOfflineDb'

let initPromise: Promise<void> | null = null

/**
 * Initialize offline caches proactively on app load.
 * This runs once per app session.
 */
export async function initializeOfflineCache(): Promise<void> {
  // Ensure we only run once
  if (initPromise) return initPromise

  initPromise = doInitialize()
  return initPromise
}

async function doInitialize(): Promise<void> {
  const { isOnline, setOfflineReady, setSyncStatus } = useOffline()
  const { isCacheStale } = useOfflineDb()

  console.log('[Offline] Initializing offline cache...')

  // If offline, just check if we have cached data
  if (!isOnline.value) {
    const hasContacts = !(await isCacheStale('contacts'))
    setOfflineReady(hasContacts)
    console.log('[Offline] Offline mode - cache ready:', hasContacts)
    return
  }

  // Online: refresh caches as needed
  try {
    // 1. Sync contacts (incremental - always run, it's cheap)
    setSyncStatus('contacts', 'syncing')
    try {
      const { refreshContactCache } = await import('./useOfflineContacts')
      await refreshContactCache()
      setSyncStatus('contacts', 'idle')
    } catch (e) {
      console.error('[Offline] Failed to sync contacts:', e)
      setSyncStatus('contacts', 'error')
    }

    // 2. Cache Set Aside threads
    setSyncStatus('setAside', 'syncing')
    try {
      const { cacheSetAsideThreads } = await import('./useOfflineThreadCache')
      await cacheSetAsideThreads()
      setSyncStatus('setAside', 'idle')
      console.log('[Offline] Set Aside cache refreshed')
    } catch (e) {
      console.error('[Offline] Failed to cache Set Aside:', e)
      setSyncStatus('setAside', 'error')
    }

    // 3. Cache Reply Later threads
    setSyncStatus('replyLater', 'syncing')
    try {
      const { cacheReplyLaterThreads } = await import('./useOfflineThreadCache')
      await cacheReplyLaterThreads()
      setSyncStatus('replyLater', 'idle')
      console.log('[Offline] Reply Later cache refreshed')
    } catch (e) {
      console.error('[Offline] Failed to cache Reply Later:', e)
      setSyncStatus('replyLater', 'error')
    }

    // 4. Cache inbox top 20
    setSyncStatus('threads', 'syncing')
    try {
      const { cacheInboxThreads } = await import('./useOfflineThreadCache')
      await cacheInboxThreads()
      setSyncStatus('threads', 'idle')
      console.log('[Offline] Inbox threads cached')
    } catch (e) {
      console.error('[Offline] Failed to cache inbox:', e)
      setSyncStatus('threads', 'error')
    }

    // 5. Sync any pending drafts
    setSyncStatus('drafts', 'syncing')
    try {
      const { syncPendingDrafts } = await import('./useOfflineDrafts')
      await syncPendingDrafts()
      setSyncStatus('drafts', 'idle')
    } catch (e) {
      console.error('[Offline] Failed to sync drafts:', e)
      setSyncStatus('drafts', 'error')
    }

    setOfflineReady(true)
    console.log('[Offline] Initialization complete')
  } catch (e) {
    console.error('[Offline] Initialization failed:', e)
    // Still mark as ready if we have some cached data
    const hasContacts = !(await isCacheStale('contacts'))
    setOfflineReady(hasContacts)
  }
}

/**
 * Force refresh all caches (called on manual sync)
 */
export async function refreshAllCaches(): Promise<void> {
  const { isOnline } = useOffline()
  if (!isOnline.value) return

  const { clearCache } = useOfflineDb()

  // Clear stale caches
  await clearCache('contacts')
  await clearCache('threads')
  await clearCache('setAside')
  await clearCache('replyLater')

  // Re-initialize
  initPromise = null
  await initializeOfflineCache()
}
