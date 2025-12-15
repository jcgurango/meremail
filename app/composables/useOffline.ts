import { ref, computed, onMounted, onUnmounted } from 'vue'

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'pending'

interface OfflineState {
  isOnline: Ref<boolean>
  isOfflineReady: Ref<boolean>  // True when offline data is available
  syncStatus: Ref<Record<string, SyncStatus>>
  pendingSyncCount: Ref<number>
  lastSyncAt: Ref<number | null>
}

// Shared state across all component instances
const isOnline = ref(true)
const isOfflineReady = ref(false)
const syncStatus = ref<Record<string, SyncStatus>>({
  contacts: 'idle',
  drafts: 'idle',
  threads: 'idle',
  setAside: 'idle',
  replyLater: 'idle',
})
const pendingSyncCount = ref(0)
const lastSyncAt = ref<number | null>(null)

let initialized = false

export function useOffline(): OfflineState & {
  triggerSync: () => Promise<void>
  setSyncStatus: (key: string, status: SyncStatus) => void
  setOfflineReady: (ready: boolean) => void
  setPendingSyncCount: (count: number) => void
} {
  // Initialize online/offline listeners once
  if (!initialized && import.meta.client) {
    initialized = true
    isOnline.value = navigator.onLine

    const handleOnline = () => {
      isOnline.value = true
      // Trigger sync when coming back online
      triggerSync()
    }
    const handleOffline = () => {
      isOnline.value = false
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
  }

  const setSyncStatus = (key: string, status: SyncStatus) => {
    syncStatus.value[key] = status
  }

  const setOfflineReady = (ready: boolean) => {
    isOfflineReady.value = ready
  }

  const setPendingSyncCount = (count: number) => {
    pendingSyncCount.value = count
  }

  const triggerSync = async () => {
    if (!isOnline.value) return

    // Import sync functions dynamically to avoid circular deps
    try {
      const { syncPendingDrafts } = await import('./useOfflineDrafts')
      const { refreshContactCache } = await import('./useOfflineContacts')
      const { refreshThreadCaches } = await import('./useOfflineThreadCache')

      // Sync drafts first (most important)
      setSyncStatus('drafts', 'syncing')
      try {
        await syncPendingDrafts()
        setSyncStatus('drafts', 'idle')
      } catch (e) {
        console.error('Draft sync failed:', e)
        setSyncStatus('drafts', 'error')
      }

      // Refresh caches in background
      refreshContactCache().catch(console.error)
      refreshThreadCaches().catch(console.error)

      lastSyncAt.value = Date.now()
    } catch (e) {
      console.error('Sync failed:', e)
    }
  }

  return {
    isOnline,
    isOfflineReady,
    syncStatus,
    pendingSyncCount,
    lastSyncAt,
    triggerSync,
    setSyncStatus,
    setOfflineReady,
    setPendingSyncCount,
  }
}

// Computed helper for overall sync state
export function useOfflineStatus() {
  const { isOnline, syncStatus, pendingSyncCount } = useOffline()

  const isSyncing = computed(() =>
    Object.values(syncStatus.value).some(s => s === 'syncing')
  )

  const hasErrors = computed(() =>
    Object.values(syncStatus.value).some(s => s === 'error')
  )

  const hasPendingSync = computed(() => pendingSyncCount.value > 0)

  const overallStatus = computed<'online' | 'syncing' | 'pending' | 'offline' | 'error'>(() => {
    if (!isOnline.value) return 'offline'
    if (hasErrors.value) return 'error'
    if (isSyncing.value) return 'syncing'
    if (hasPendingSync.value) return 'pending'
    return 'online'
  })

  return {
    isOnline,
    isSyncing,
    hasErrors,
    hasPendingSync,
    overallStatus,
  }
}
