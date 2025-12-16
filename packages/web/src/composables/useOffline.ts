import { ref, computed } from 'vue'

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
    })
    window.addEventListener('offline', () => {
      isOnline.value = false
    })
  }

  return {
    isOnline,
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
