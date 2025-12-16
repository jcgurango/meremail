import { ref, readonly } from 'vue'
import { syncAll } from './useSync'

let initPromise: Promise<void> | null = null

// Reactive state for sync initialization
const hasCompletedInitialSync = ref(false)
const isInitialSyncInProgress = ref(false)
const initialSyncError = ref<Error | null>(null)

// Increment this to signal components to reload
const syncVersion = ref(0)

/**
 * Initialize sync on app load.
 * Runs once per app session, fetches all data proactively.
 */
export async function initializeSync(): Promise<void> {
  // Ensure we only run once
  if (initPromise) return initPromise

  initPromise = doInitialize()
  return initPromise
}

async function doInitialize(): Promise<void> {
  console.log('[SyncInit] Starting sync initialization...')
  isInitialSyncInProgress.value = true
  initialSyncError.value = null

  try {
    await syncAll()
    console.log('[SyncInit] Sync initialization complete')
    hasCompletedInitialSync.value = true
    syncVersion.value++  // Signal components to reload
  } catch (e) {
    console.error('[SyncInit] Sync initialization failed:', e)
    initialSyncError.value = e as Error
    // Don't throw - app should still work, just without cached data
  } finally {
    isInitialSyncInProgress.value = false
  }
}

/**
 * Force a fresh sync (clears cache and re-syncs)
 */
export async function forceResync(): Promise<void> {
  const { clearSyncData } = await import('./useSync')
  await clearSyncData()
  initPromise = null
  hasCompletedInitialSync.value = false
  await initializeSync()
}

/**
 * Composable to access sync initialization state
 */
export function useSyncInit() {
  return {
    hasCompletedInitialSync: readonly(hasCompletedInitialSync),
    isInitialSyncInProgress: readonly(isInitialSyncInProgress),
    initialSyncError: readonly(initialSyncError),
    syncVersion: readonly(syncVersion),
    initializeSync,
    forceResync,
  }
}
