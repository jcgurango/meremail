/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> }

// Background Sync API types
interface SyncEvent extends ExtendableEvent {
  tag: string
  lastChance: boolean
}

// Precache static assets
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Background Sync: when connectivity is restored, notify clients to sync
self.addEventListener('sync', ((event: SyncEvent) => {
  if (event.tag === 'pending-sync') {
    event.waitUntil(notifyClientsToSync())
  }
}) as EventListener)

async function notifyClientsToSync(): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window' })

  if (clients.length > 0) {
    // Notify open clients to run sync
    for (const client of clients) {
      client.postMessage({ type: 'SYNC_REQUESTED' })
    }
  } else {
    // No clients open - could implement direct sync here if needed
    // For now, the sync will happen when the user opens the app
    console.log('[SW] No clients open for background sync')
  }
}

// Handle messages from main thread
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
