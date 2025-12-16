import { syncAll } from './useSync'

let initPromise: Promise<void> | null = null

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

  try {
    await syncAll()
    console.log('[SyncInit] Sync initialization complete')
  } catch (e) {
    console.error('[SyncInit] Sync initialization failed:', e)
    // Don't throw - app should still work, just without cached data
  }
}

/**
 * Force a fresh sync (clears cache and re-syncs)
 */
export async function forceResync(): Promise<void> {
  const { clearSyncData } = await import('./useSync')
  await clearSyncData()
  initPromise = null
  await initializeSync()
}
