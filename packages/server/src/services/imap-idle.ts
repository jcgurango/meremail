import {
  createImapClient,
  toImportableEmail,
  backupEml,
  importEmail,
  deleteRetrieved,
  toDate,
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

export interface PullResult {
  imported: number
  skipped: number
  errors: number
}

class ImapIdleService {
  private client: ImapFlow | null = null
  private isRunning = false
  private reconnectDelay = INITIAL_RECONNECT_DELAY
  private idleRestartTimer: NodeJS.Timeout | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private lastPollTime: Record<string, Date> = {}
  // Highest INBOX UID seen on the current connection; new mail is fetched from here
  private lastUid = 0
  // EXISTS handlers run one after another so each sees the UIDs the previous one fetched
  private newMailChain: Promise<void> = Promise.resolve()
  // The other-folders poll in progress, shared by the timer and forced pulls
  private pollInFlight: Promise<PullResult> | null = null

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
    if (config.imap.deleteMode) {
      console.log('[ImapIdle] - DELETE_MODE on: mail is deleted from the IMAP server once retrieved')
    }

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
    this.lastUid = (mailbox.uidNext ?? 1) - 1

    // Do an initial fetch of recent emails
    await this.fetchRecentEmails()

    // Set up event handlers
    this.client.on('exists', (data: { path: string; count: number; prevCount: number }) => {
      if (data.count > data.prevCount) {
        console.log(`[ImapIdle] New mail detected! Count: ${data.prevCount} -> ${data.count}`)
        this.newMailChain = this.newMailChain.then(() => this.fetchNewEmails()).then(() => {})
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
   * Initial INBOX fetch on connect: everything in DELETE_MODE (the mailbox
   * only holds mail not yet retrieved), otherwise the last 24 hours.
   */
  private async fetchRecentEmails(): Promise<PullResult> {
    if (config.imap.deleteMode) return this.fetchInbox('1:*', 'Initial fetch')
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    return this.fetchInbox({ since }, 'Initial fetch')
  }

  /**
   * Fetch new emails after EXISTS notification.
   *
   * In DELETE_MODE everything still in the mailbox is fetched: retrieved mail
   * is deleted, so whatever is left is mail we haven't stored yet (or failed
   * to). Otherwise fetched by UID rather than sequence number: sequence
   * numbers shift on expunge, and a range starting past the end of the
   * mailbox gets a BAD "Invalid messageset" from some servers. A UID range
   * past the end is accepted but returns the newest message, so UIDs we have
   * already seen are skipped.
   */
  private async fetchNewEmails(): Promise<PullResult> {
    if (config.imap.deleteMode) return this.fetchInbox('1:*', 'New mail')
    return this.fetchInbox(`${this.lastUid + 1}:*`, 'New mail', { onlyNewUids: true })
  }

  /**
   * Fetch INBOX messages matching a query, import them, and delete the
   * retrieved ones from the server in DELETE_MODE.
   */
  private async fetchInbox(
    query: string | { since: Date },
    label: string,
    { onlyNewUids = false }: { onlyNewUids?: boolean } = {}
  ): Promise<PullResult> {
    const result: PullResult = { imported: 0, skipped: 0, errors: 0 }
    const client = this.client
    if (!client) return result
    // Some servers reject a fetch on an empty mailbox
    if (!client.mailbox || client.mailbox.exists === 0) return result

    try {
      const retrieved: number[] = []
      for await (const message of client.fetch(query, {
        uid: true,
        source: true,
        flags: true,
        internalDate: true,
      }, { uid: typeof query === 'string' })) {
        if (onlyNewUids && message.uid <= this.lastUid) continue
        this.lastUid = Math.max(this.lastUid, message.uid)

        const outcome = await this.processMessage(message, 'INBOX')
        if (outcome === 'imported') result.imported++
        else if (outcome === 'skipped') result.skipped++
        else result.errors++
        if (outcome !== 'error' && message.source) retrieved.push(message.uid)
      }

      await this.deleteFromServer(client, retrieved, 'INBOX')

      if (result.imported > 0 || result.errors > 0) {
        console.log(`[ImapIdle] ${label}: ${result.imported} imported, ${result.skipped} skipped, ${result.errors} failed`)
      }
    } catch (error) {
      console.error(`[ImapIdle] ${label}: error fetching INBOX:`, error)
      result.errors++
    }
    return result
  }

  /**
   * Pull mail now, on request: re-fetch INBOX (everything in DELETE_MODE,
   * otherwise the last 24 hours, catching anything an EXISTS notification
   * missed) and poll the other folders. Duplicates are skipped on import.
   */
  async forcePull(): Promise<PullResult> {
    if (!this.isConfigured()) throw new Error('IMAP is not configured')
    if (!this.client) throw new Error('Not connected to the IMAP server')

    // Queued behind any EXISTS handler so the two never fetch at once
    const inbox = this.newMailChain.then(() => this.fetchRecentEmails())
    this.newMailChain = inbox.then(() => {}, () => {})
    const [fromInbox, fromOthers] = await Promise.all([inbox, this.pollOtherFolders()])
    return {
      imported: fromInbox.imported + fromOthers.imported,
      skipped: fromInbox.skipped + fromOthers.skipped,
      errors: fromInbox.errors + fromOthers.errors,
    }
  }

  /**
   * Process a single message
   */
  private async processMessage(
    message: { uid: number; source?: Buffer; flags?: Set<string>; internalDate?: Date | string },
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
        internalDate: toDate(message.internalDate),
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
   * Delete retrieved messages from the server (DELETE_MODE only).
   * A failure here leaves the mail on the server; it is skipped as a
   * duplicate and deleted on a later fetch.
   */
  private async deleteFromServer(client: ImapFlow, uids: number[], folder: string): Promise<void> {
    try {
      const deleted = await deleteRetrieved(client, uids)
      if (deleted > 0) {
        console.log(`[ImapIdle] ${folder}: deleted ${deleted} retrieved email(s) from server`)
      }
    } catch (error) {
      console.error(`[ImapIdle] Error deleting retrieved emails from ${folder}:`, error)
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
  private pollOtherFolders(): Promise<PullResult> {
    if (!this.pollInFlight) {
      this.pollInFlight = this.runPollOtherFolders().finally(() => {
        this.pollInFlight = null
      })
    }
    return this.pollInFlight
  }

  private async runPollOtherFolders(): Promise<PullResult> {
    const total: PullResult = { imported: 0, skipped: 0, errors: 0 }
    if (!this.isRunning) return total

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
          const startedAt = new Date()

          const mailbox = await pollClient.mailboxOpen(folder)
          // Some servers reject a fetch on an empty mailbox
          if (mailbox.exists === 0) {
            this.lastPollTime[folder] = startedAt
            continue
          }

          let imported = 0
          let skipped = 0
          const retrieved: number[] = []

          // In DELETE_MODE the folder only holds mail not yet retrieved
          const query = config.imap.deleteMode ? '1:*' : { since: lastPoll }

          for await (const message of pollClient.fetch(query, {
            uid: true,
            source: true,
            flags: true,
            internalDate: true,
          })) {
            const result = await this.processMessage(message, folder)
            if (result === 'imported') imported++
            else if (result === 'skipped') skipped++
            else total.errors++
            if (result !== 'error' && message.source) retrieved.push(message.uid)
          }

          await this.deleteFromServer(pollClient, retrieved, folder)

          // From when this poll started, so mail arriving during it isn't missed
          this.lastPollTime[folder] = startedAt
          total.imported += imported
          total.skipped += skipped

          if (imported > 0) {
            console.log(`[ImapIdle] ${folder}: ${imported} imported, ${skipped} skipped`)
          }
        } catch (error) {
          console.error(`[ImapIdle] Error polling folder ${folder}:`, error)
          total.errors++
        }
      }
    } catch (error) {
      console.error('[ImapIdle] Error polling other folders:', error)
      total.errors++
    } finally {
      if (pollClient) {
        try {
          await pollClient.logout()
        } catch {
          // Ignore
        }
      }
    }
    return total
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
 * Pull mail from the IMAP server now instead of waiting for IDLE or the poll
 */
export function forceImapPull(): Promise<PullResult> {
  return imapIdleService.forcePull()
}

/**
 * Stop the IMAP IDLE service
 */
export function stopImapIdle(): void {
  imapIdleService.stop()
}
