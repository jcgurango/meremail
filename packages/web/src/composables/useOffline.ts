import { ref, computed } from 'vue'
import { syncAll } from './useSync'

// Shared state across all component instances
const isOnline = ref(true)

let initialized = false

/**
 * Simple online/offline status tracking.
 * Use api.ts functions for data fetching - they handle offline fallback automatically.
 */
export function useOffline() {
  // Initialize online/offline listeners once
  if (!initialized && typeof window !== 'undefined') {
    initialized = true
    isOnline.value = navigator.onLine

    window.addEventListener('online', () => {
      isOnline.value = true
      // Sync pending changes when we come back online
      syncAll().catch(err => console.error('[Offline] Failed to sync on reconnect:', err))
    })
    window.addEventListener('offline', () => {
      isOnline.value = false
    })

    // Listen for service worker messages (background sync)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'SYNC_REQUESTED') {
          console.log('[Offline] Background sync requested by service worker')
          syncAll().catch(err => console.error('[Offline] Failed background sync:', err))
        }
      })
    }
  }

  return {
    isOnline,
  }
}

/**
 * Register a background sync to run when connectivity is restored.
 * Call this when adding items to pendingSync.
 */
export async function registerBackgroundSync(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) {
    return // Background sync not supported
  }

  try {
    const registration = await navigator.serviceWorker.ready
    // Type assertion for Background Sync API
    const syncManager = (registration as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync
    await syncManager.register('pending-sync')
    console.log('[Offline] Background sync registered')
  } catch (err) {
    console.error('[Offline] Failed to register background sync:', err)
  }
}

/**
 * Computed helper for offline status display.
 */
export function useOfflineStatus() {
  const { isOnline } = useOffline()

  const overallStatus = computed<'online' | 'offline'>(() => {
    return isOnline.value ? 'online' : 'offline'
  })

  return {
    isOnline,
    overallStatus,
  }
}
