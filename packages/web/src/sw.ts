/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> }

// Background Sync API types
interface SyncEvent extends ExtendableEvent {
  tag: string
  lastChance: boolean
}

// Periodic Background Sync API types
interface PeriodicSyncEvent extends ExtendableEvent {
  tag: string
}

// Extended notification options with actions (service worker specific)
interface ExtendedNotificationOptions extends NotificationOptions {
  actions?: Array<{ action: string; title: string; icon?: string }>
}

// Notification data from API
interface PendingEmail {
  id: number
  threadId: number
  subject: string
  snippet: string
  sentAt: number
  senderName: string | null
  senderEmail: string
}

interface NotificationResponse {
  emails: PendingEmail[]
  feedUnread: number
  paperTrailUnread: number
}

// IndexedDB helpers for notification state
const DB_NAME = 'meremail-sw'
const DB_VERSION = 1
const STORE_NAME = 'notification-state'

async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
  })
}

async function getState<T>(key: string): Promise<T | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(key)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result ?? null)
    tx.oncomplete = () => db.close()
  })
}

async function setState<T>(key: string, value: T): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.put(value, key)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
    tx.oncomplete = () => db.close()
  })
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
    for (const client of clients) {
      client.postMessage({ type: 'SYNC_REQUESTED' })
    }
  } else {
    console.log('[SW] No clients open for background sync')
  }
}

// Periodic Background Sync: check for new emails and show notifications
self.addEventListener('periodicsync', ((event: PeriodicSyncEvent) => {
  if (event.tag === 'check-emails') {
    event.waitUntil(checkForNewEmails())
  }
}) as EventListener)

async function checkForNewEmails(): Promise<void> {
  try {
    console.log('[SW] Checking for new emails...')

    // Fetch pending notifications from server
    const response = await fetch('/api/notifications/pending')
    if (!response.ok) {
      console.error('[SW] Failed to fetch notifications:', response.status)
      return
    }

    const data: NotificationResponse = await response.json()

    // Get previously notified email IDs
    const notifiedIds = new Set<number>(await getState<number[]>('notifiedIds') || [])

    // Show notifications for new emails
    for (const email of data.emails) {
      if (!notifiedIds.has(email.id)) {
        await showEmailNotification(email)
        notifiedIds.add(email.id)
      }
    }

    // Save updated notified IDs (keep last 500 to prevent unbounded growth)
    const idsArray = Array.from(notifiedIds).slice(-500)
    await setState('notifiedIds', idsArray)

    // Check if we should show daily digest
    await checkDailyDigest(data.feedUnread, data.paperTrailUnread)

    console.log('[SW] Notification check complete')
  } catch (err) {
    console.error('[SW] Error checking for new emails:', err)
  }
}

async function showEmailNotification(email: PendingEmail): Promise<void> {
  const senderDisplay = email.senderName || email.senderEmail

  const options: ExtendedNotificationOptions = {
    body: `${email.subject}\n${email.snippet}`,
    tag: `email-${email.id}`,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    data: {
      type: 'email',
      emailId: email.id,
      threadId: email.threadId,
    },
    actions: [
      { action: 'mark-read', title: 'Mark as Read' },
    ],
  }

  await self.registration.showNotification(senderDisplay, options)
}

async function checkDailyDigest(feedUnread: number, paperTrailUnread: number): Promise<void> {
  // Skip if no unread emails
  if (feedUnread === 0 && paperTrailUnread === 0) {
    return
  }

  const now = new Date()
  const hour = now.getHours()

  // Only show digest at 9 PM (21:00) or later
  if (hour < 21) {
    return
  }

  // Check if at least 23 hours since last digest
  const lastDigestAt = await getState<number>('lastDigestAt')
  const minInterval = 23 * 60 * 60 * 1000 // 23 hours in ms

  if (lastDigestAt && (now.getTime() - lastDigestAt) < minInterval) {
    return
  }

  // Build digest message
  const parts: string[] = []
  if (paperTrailUnread > 0) {
    parts.push(`${paperTrailUnread} new in paper trail`)
  }
  if (feedUnread > 0) {
    parts.push(`${feedUnread} new in feed`)
  }

  const body = parts.join(', ')
  const destination = paperTrailUnread > 0 ? 'paper_trail' : 'feed'

  await self.registration.showNotification('MereMail Daily Digest', {
    body,
    tag: 'daily-digest',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    data: {
      type: 'digest',
      destination,
    },
  })

  await setState('lastDigestAt', now.getTime())
  console.log('[SW] Daily digest notification shown')
}

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const data = event.notification.data
  let url = '/'

  if (data?.type === 'email' && data.threadId) {
    url = `/thread/${data.threadId}`
  } else if (data?.type === 'digest' && data.destination) {
    url = `/${data.destination}`
  }

  // Handle action buttons
  if (event.action === 'mark-read' && data?.type === 'email' && data.emailId) {
    event.waitUntil(markEmailAsRead(data.emailId))
    return
  }

  // Open or focus the app
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      // Try to focus an existing window
      for (const client of clients) {
        if ('focus' in client) {
          client.focus()
          client.postMessage({ type: 'NAVIGATE', url })
          return
        }
      }
      // Open new window if none exists
      return self.clients.openWindow(url)
    })
  )
})

async function markEmailAsRead(emailId: number): Promise<void> {
  try {
    const response = await fetch('/api/emails/mark-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [emailId] }),
    })

    if (!response.ok) {
      console.error('[SW] Failed to mark email as read:', response.status)
    }
  } catch (err) {
    console.error('[SW] Error marking email as read:', err)
  }
}

// Handle messages from main thread
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }

  // Retract notification when email is read
  if (event.data?.type === 'RETRACT_NOTIFICATION' && event.data.tag) {
    event.waitUntil(retractNotification(event.data.tag))
  }
})

async function retractNotification(tag: string): Promise<void> {
  const notifications = await self.registration.getNotifications({ tag })
  for (const notification of notifications) {
    notification.close()
  }
}
