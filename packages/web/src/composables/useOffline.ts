import { ref } from 'vue'
import { isOnline, syncNow } from '@/local/sync'

// Shared state across all component instances
const notificationPermission = ref<NotificationPermission>('default')

let initialized = false
let navigationHandler: ((url: string) => void) | null = null

/**
 * Online/offline status, and the page's side of the service worker's messages.
 */
export function useOffline() {
  // Initialize online/offline listeners once
  if (!initialized && typeof window !== 'undefined') {
    initialized = true

    // Initialize notification permission state
    if ('Notification' in window) {
      notificationPermission.value = Notification.permission
    }

    // Listen for service worker messages
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'SYNC_REQUESTED') {
          console.log('[Offline] Background sync requested by service worker')
          syncNow()
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
