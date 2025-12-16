import { ref, computed } from 'vue'
import { syncAll } from './useSync'

// Shared state across all component instances
const isOnline = ref(true)
const notificationPermission = ref<NotificationPermission>('default')

let initialized = false
let navigationHandler: ((url: string) => void) | null = null

/**
 * Simple online/offline status tracking.
 * Use api.ts functions for data fetching - they handle offline fallback automatically.
 */
export function useOffline() {
  // Initialize online/offline listeners once
  if (!initialized && typeof window !== 'undefined') {
    initialized = true
    isOnline.value = navigator.onLine

    // Initialize notification permission state
    if ('Notification' in window) {
      notificationPermission.value = Notification.permission
    }

    window.addEventListener('online', () => {
      isOnline.value = true
      // Sync pending changes when we come back online
      syncAll().catch(err => console.error('[Offline] Failed to sync on reconnect:', err))
    })
    window.addEventListener('offline', () => {
      isOnline.value = false
    })

    // Listen for service worker messages
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'SYNC_REQUESTED') {
          console.log('[Offline] Background sync requested by service worker')
          syncAll().catch(err => console.error('[Offline] Failed background sync:', err))
        }
        // Handle navigation from notification click
        if (event.data?.type === 'NAVIGATE' && event.data.url) {
          console.log('[Offline] Navigating to:', event.data.url)
          if (navigationHandler) {
            navigationHandler(event.data.url)
          }
        }
      })
    }
  }

  return {
    isOnline,
    notificationPermission,
  }
}

/**
 * Set a handler for navigation requests from the service worker.
 * Call this from your app's main component with the router.
 */
export function setNavigationHandler(handler: (url: string) => void): void {
  navigationHandler = handler
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

/**
 * Request notification permission from the user.
 * Returns the permission result.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    console.warn('[Notifications] Not supported in this browser')
    return 'denied'
  }

  if (Notification.permission === 'granted') {
    notificationPermission.value = 'granted'
    return 'granted'
  }

  if (Notification.permission === 'denied') {
    notificationPermission.value = 'denied'
    return 'denied'
  }

  try {
    const result = await Notification.requestPermission()
    notificationPermission.value = result
    return result
  } catch (err) {
    console.error('[Notifications] Failed to request permission:', err)
    return 'denied'
  }
}

/**
 * Register periodic background sync for checking new emails.
 * Requests a 10-minute interval (actual frequency depends on browser/engagement).
 */
export async function registerPeriodicSync(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) {
    console.warn('[PeriodicSync] Service worker not supported')
    return false
  }

  try {
    const registration = await navigator.serviceWorker.ready

    // Check if periodic sync is supported
    if (!('periodicSync' in registration)) {
      console.warn('[PeriodicSync] Periodic Background Sync not supported')
      return false
    }

    // Type assertion for Periodic Background Sync API
    const periodicSync = (registration as ServiceWorkerRegistration & {
      periodicSync: {
        register: (tag: string, options?: { minInterval: number }) => Promise<void>
        getTags: () => Promise<string[]>
      }
    }).periodicSync

    // Check if already registered
    const tags = await periodicSync.getTags()
    if (tags.includes('check-emails')) {
      console.log('[PeriodicSync] Already registered')
      return true
    }

    // Register with 10-minute minimum interval
    await periodicSync.register('check-emails', {
      minInterval: 10 * 60 * 1000, // 10 minutes
    })

    console.log('[PeriodicSync] Registered successfully')
    return true
  } catch (err) {
    console.error('[PeriodicSync] Failed to register:', err)
    return false
  }
}

/**
 * Initialize notifications and periodic sync.
 * Call this after the user has granted notification permission.
 */
export async function initializeNotifications(): Promise<void> {
  const permission = await requestNotificationPermission()

  if (permission === 'granted') {
    await registerPeriodicSync()
  }
}

/**
 * Retract a notification by tag (e.g., when email is read).
 */
export async function retractNotification(tag: string): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    return
  }

  try {
    const registration = await navigator.serviceWorker.ready
    registration.active?.postMessage({ type: 'RETRACT_NOTIFICATION', tag })
  } catch (err) {
    console.error('[Notifications] Failed to retract:', err)
  }
}
