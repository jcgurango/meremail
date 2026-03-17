import { LocalNotifications } from '@capacitor/local-notifications'
import { isNative } from '@/utils/native-config'

// Track which email IDs we've already notified about (in-memory set)
const notifiedIds = new Set<number>()

export function useBackgroundPoller(syncAll: () => Promise<void>) {
  let pollInterval: ReturnType<typeof setInterval> | null = null

  async function start() {
    if (!isNative()) return

    // Request notification permission
    await LocalNotifications.requestPermissions()

    // Start polling
    pollInterval = setInterval(pollForNotifications, 30_000)
    // Also poll immediately
    pollForNotifications()
  }

  async function pollForNotifications() {
    try {
      const response = await fetch('/api/notifications/pending')
      if (!response.ok) return
      const data = await response.json()

      let hasNew = false
      for (const email of data.emails) {
        if (notifiedIds.has(email.id)) continue
        notifiedIds.add(email.id)
        hasNew = true

        await LocalNotifications.schedule({
          notifications: [{
            title: email.senderName || email.senderEmail,
            body: email.subject || '(No subject)',
            id: email.id,
            extra: { threadId: email.threadId },
          }],
        })
      }

      // If there were new emails, trigger sync
      if (hasNew) {
        await syncAll()
      }
    } catch {
      // Silently ignore — will retry on next interval
    }
  }

  function stop() {
    if (pollInterval) clearInterval(pollInterval)
    pollInterval = null
  }

  return { start, stop }
}
