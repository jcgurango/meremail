import {
  createImapClient,
  toImportableEmail,
  backupEml,
  importEmail,
  config,
  type FetchedEmail,
} from '@meremail/shared'
import { simpleParser } from 'mailparser'

// Use any for ImapFlow since the type is in the shared package's dependencies
type ImapFlow = Awaited<ReturnType<typeof createImapClient>>

// IDLE restart interval (25 minutes - before 29 min RFC timeout)
const IDLE_RESTART_INTERVAL = 25 * 60 * 1000

// Reconnection backoff settings
const INITIAL_RECONNECT_DELAY = 5000 // 5 seconds
const MAX_RECONNECT_DELAY = 5 * 60 * 1000 // 5 minutes
const BACKOFF_MULTIPLIER = 2

// Polling interval for non-INBOX folders
const OTHER_FOLDERS_POLL_INTERVAL = 15 * 60 * 1000 // 15 minutes

// Folders to poll (non-INBOX)
const POLL_FOLDERS = ['Sent', 'Sent Items', 'Sent Mail', '[Gmail]/Sent Mail', 'Junk']

class ImapIdleService {
  private client: ImapFlow | null = null
  private isRunning = false
  private reconnectDelay = INITIAL_RECONNECT_DELAY
  private idleRestartTimer: NodeJS.Timeout | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private lastPollTime: Record<string, Date> = {}

  /**
   * Check if IMAP is configured
   */
  private isConfigured(): boolean {
    return !!(config.imap.host && config.imap.user && config.imap.pass)
  }

  /**
   * Start the IDLE service
   */
  async start(): Promise<void> {
    if (!this.isConfigured()) {
      console.log('[ImapIdle] IMAP not configured, service disabled')
      return
    }

    if (this.isRunning) {
      console.log('[ImapIdle] Service already running')
      return
    }

    this.isRunning = true
    console.log('[ImapIdle] Starting IMAP IDLE service...')
    console.log(`[ImapIdle] - IDLE restart interval: ${IDLE_RESTART_INTERVAL / 1000}s`)
    console.log(`[ImapIdle] - Other folders poll interval: ${OTHER_FOLDERS_POLL_INTERVAL / 1000}s`)

    // Start the main IDLE loop
    this.runIdleLoop()

    // Start polling for other folders
    this.startOtherFoldersPolling()
  }

  /**
   * Stop the IDLE service
   */
  async stop(): Promise<void> {
    this.isRunning = false

    if (this.idleRestartTimer) {
      clearTimeout(this.idleRestartTimer)
      this.idleRestartTimer = null
    }

    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }

    if (this.client) {
      try {
        await this.client.logout()
      } catch {
        // Ignore logout errors
      }
      this.client = null
    }

    console.log('[ImapIdle] Service stopped')
  }

  /**
   * Main IDLE loop - connects and maintains IDLE on INBOX
   */
  private async runIdleLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.connectAndIdle()
      } catch (error) {
        if (!this.isRunning) break

        console.error('[ImapIdle] Connection error:', error)
        await this.handleReconnect()
      }
    }
  }

  /**
   * Connect to IMAP and start IDLE on INBOX
   */
  private async connectAndIdle(): Promise<void> {
    console.log('[ImapIdle] Connecting to IMAP server...')
    this.client = await createImapClient()
    this.reconnectDelay = INITIAL_RECONNECT_DELAY // Reset backoff on successful connect

    console.log('[ImapIdle] Connected, selecting INBOX...')
    const mailbox = await this.client.mailboxOpen('INBOX')
    console.log(`[ImapIdle] INBOX opened - ${mailbox.exists} messages`)

    // Do an initial fetch of recent emails
    await this.fetchRecentEmails()

    // Set up event handlers
    this.client.on('exists', async (data: { path: string; count: number; prevCount: number }) => {
      if (data.count > data.prevCount) {
        console.log(`[ImapIdle] New mail detected! Count: ${data.prevCount} -> ${data.count}`)
        await this.fetchNewEmails(data.prevCount)
      }
    })

    this.client.on('close', () => {
      if (this.isRunning) {
        console.log('[ImapIdle] Connection closed unexpectedly')
      }
    })

    this.client.on('error', (err: Error) => {
      console.error('[ImapIdle] Client error:', err.message)
    })

    // Start IDLE loop
    while (this.isRunning && this.client) {
      try {
        console.log('[ImapIdle] Entering IDLE mode...')

        // Set up timer to restart IDLE before timeout
        const idlePromise = this.client.idle()

        this.idleRestartTimer = setTimeout(async () => {
          if (this.client) {
            console.log('[ImapIdle] Restarting IDLE (timeout prevention)...')
            // This will cause idle() to return
            try {
              // Send NOOP to break out of IDLE gracefully
              await this.client.noop()
            } catch {
              // Ignore - connection may be closed
            }
          }
        }, IDLE_RESTART_INTERVAL)

        await idlePromise

        if (this.idleRestartTimer) {
          clearTimeout(this.idleRestartTimer)
          this.idleRestartTimer = null
        }
      } catch (error) {
        if (this.idleRestartTimer) {
          clearTimeout(this.idleRestartTimer)
          this.idleRestartTimer = null
        }
        throw error
      }
    }
  }

  /**
   * Fetch recent emails (last 24 hours) on connect
   */
  private async fetchRecentEmails(): Promise<void> {
    if (!this.client) return

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    console.log('[ImapIdle] Fetching recent emails since', since.toISOString())

    try {
      let imported = 0
      let skipped = 0

      for await (const message of this.client.fetch({ since }, {
        uid: true,
        source: true,
        flags: true,
      })) {
        const result = await this.processMessage(message, 'INBOX')
        if (result === 'imported') imported++
        else if (result === 'skipped') skipped++
      }

      if (imported > 0 || skipped > 0) {
        console.log(`[ImapIdle] Initial fetch: ${imported} imported, ${skipped} skipped`)
      }
    } catch (error) {
      console.error('[ImapIdle] Error fetching recent emails:', error)
    }
  }

  /**
   * Fetch new emails after EXISTS notification
   */
  private async fetchNewEmails(prevCount: number): Promise<void> {
    if (!this.client) return

    try {
      // Fetch messages with sequence numbers > prevCount
      const range = `${prevCount + 1}:*`
      let imported = 0

      for await (const message of this.client.fetch(range, {
        uid: true,
        source: true,
        flags: true,
      })) {
        const result = await this.processMessage(message, 'INBOX')
        if (result === 'imported') imported++
      }

      if (imported > 0) {
        console.log(`[ImapIdle] Imported ${imported} new email(s)`)
      }
    } catch (error) {
      console.error('[ImapIdle] Error fetching new emails:', error)
    }
  }

  /**
   * Process a single message
   */
  private async processMessage(
    message: { uid: number; source?: Buffer; flags?: Set<string> },
    folder: string
  ): Promise<'imported' | 'skipped' | 'error'> {
    if (!message.source) return 'skipped'

    try {
      const parsed = await simpleParser(message.source, { skipImageLinks: true })

      const fetched = {
        uid: message.uid,
        folder,
        parsed,
        raw: message.source,
        flags: message.flags ?? new Set<string>(),
      }

      // Backup raw EML
      backupEml(fetched)

      // Convert and import
      const importable = toImportableEmail(fetched)
      const result = await importEmail(importable)

      return result.imported ? 'imported' : 'skipped'
    } catch (error) {
      console.error(`[ImapIdle] Error processing message UID ${message.uid}:`, error)
      return 'error'
    }
  }

  /**
   * Handle reconnection with exponential backoff
   */
  private async handleReconnect(): Promise<void> {
    if (!this.isRunning) return

    console.log(`[ImapIdle] Reconnecting in ${this.reconnectDelay / 1000}s...`)
    await this.sleep(this.reconnectDelay)

    // Increase delay for next time (exponential backoff)
    this.reconnectDelay = Math.min(
      this.reconnectDelay * BACKOFF_MULTIPLIER,
      MAX_RECONNECT_DELAY
    )

    // Clean up old client
    if (this.client) {
      try {
        await this.client.logout()
      } catch {
        // Ignore
      }
      this.client = null
    }
  }

  /**
   * Start polling for non-INBOX folders
   */
  private startOtherFoldersPolling(): void {
    // Initial poll after 30 seconds
    setTimeout(() => this.pollOtherFolders(), 30000)

    // Then poll on interval
    this.pollTimer = setInterval(() => {
      this.pollOtherFolders()
    }, OTHER_FOLDERS_POLL_INTERVAL)
  }

  /**
   * Poll non-INBOX folders for new emails
   */
  private async pollOtherFolders(): Promise<void> {
    if (!this.isRunning) return

    let pollClient: ImapFlow | null = null

    try {
      pollClient = await createImapClient()
      const availableFolders = await this.listFolders(pollClient)

      // Filter to folders we want to poll
      const foldersToSync = availableFolders.filter(folder =>
        POLL_FOLDERS.some(pf => folder.toLowerCase() === pf.toLowerCase())
      )

      for (const folder of foldersToSync) {
        try {
          const lastPoll = this.lastPollTime[folder] || new Date(Date.now() - 24 * 60 * 60 * 1000)

          await pollClient.mailboxOpen(folder)

          let imported = 0
          let skipped = 0

          for await (const message of pollClient.fetch({ since: lastPoll }, {
            uid: true,
            source: true,
            flags: true,
          })) {
            const result = await this.processMessage(message, folder)
            if (result === 'imported') imported++
            else if (result === 'skipped') skipped++
          }

          this.lastPollTime[folder] = new Date()

          if (imported > 0) {
            console.log(`[ImapIdle] ${folder}: ${imported} imported, ${skipped} skipped`)
          }
        } catch (error) {
          console.error(`[ImapIdle] Error polling folder ${folder}:`, error)
        }
      }
    } catch (error) {
      console.error('[ImapIdle] Error polling other folders:', error)
    } finally {
      if (pollClient) {
        try {
          await pollClient.logout()
        } catch {
          // Ignore
        }
      }
    }
  }

  /**
   * List available folders
   */
  private async listFolders(client: ImapFlow): Promise<string[]> {
    const folders = await client.list() as { path: string }[]
    return folders.map(f => f.path)
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// Singleton instance
const imapIdleService = new ImapIdleService()

/**
 * Start the IMAP IDLE service
 */
export function startImapIdle(): void {
  imapIdleService.start()
}

/**
 * Stop the IMAP IDLE service
 */
export function stopImapIdle(): void {
  imapIdleService.stop()
}
