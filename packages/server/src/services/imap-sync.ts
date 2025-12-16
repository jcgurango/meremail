import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import {
  createImapClient,
  fetchEmails,
  listFolders,
  toImportableEmail,
  backupEml,
  importEmail,
  config,
  resolvePath,
} from '@meremail/shared'

// State file to track sync progress
const STATE_FILE = resolvePath('data/.imap-sync-state.json')

// Sync interval (5 minutes)
const SYNC_INTERVAL = 5 * 60 * 1000

// Folders to sync (common inbox/sent folders)
const DEFAULT_FOLDERS = ['INBOX', 'Sent', 'Sent Items', 'Sent Mail', '[Gmail]/Sent Mail']

interface SyncState {
  lastSyncPerFolder: Record<string, string> // ISO date strings
  lastFullSync: string | null
}

function loadState(): SyncState {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
    }
  } catch (error) {
    console.error('[ImapSync] Error loading state:', error)
  }
  return { lastSyncPerFolder: {}, lastFullSync: null }
}

function saveState(state: SyncState): void {
  try {
    const dir = dirname(STATE_FILE)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  } catch (error) {
    console.error('[ImapSync] Error saving state:', error)
  }
}

/**
 * Check if IMAP is configured
 */
function isImapConfigured(): boolean {
  return !!(config.imap.host && config.imap.user && config.imap.pass)
}

/**
 * Sync emails from IMAP server
 */
async function syncEmails(): Promise<{ imported: number; skipped: number; errors: number }> {
  if (!isImapConfigured()) {
    return { imported: 0, skipped: 0, errors: 0 }
  }

  const state = loadState()
  const syncStartTime = new Date()

  let totalImported = 0
  let totalSkipped = 0
  let totalErrors = 0

  let client
  try {
    client = await createImapClient()
  } catch (error) {
    console.error('[ImapSync] Failed to connect to IMAP:', error)
    return { imported: 0, skipped: 0, errors: 1 }
  }

  try {
    // Get available folders
    const availableFolders = await listFolders(client)

    // Filter to folders we want to sync
    const foldersToSync = availableFolders.filter(folder =>
      DEFAULT_FOLDERS.some(df => folder.toLowerCase() === df.toLowerCase())
    )

    // If no standard folders found, fall back to just INBOX
    if (foldersToSync.length === 0 && availableFolders.includes('INBOX')) {
      foldersToSync.push('INBOX')
    }

    for (const folder of foldersToSync) {
      try {
        // Get last sync time for this folder (default to 24 hours ago for first sync)
        const lastSyncStr = state.lastSyncPerFolder[folder]
        const since = lastSyncStr
          ? new Date(lastSyncStr)
          : new Date(Date.now() - 24 * 60 * 60 * 1000)

        let folderImported = 0
        let folderSkipped = 0

        for await (const fetched of fetchEmails(client, folder, since)) {
          try {
            // Backup raw EML
            backupEml(fetched)

            // Convert and import
            const importable = toImportableEmail(fetched)
            const result = await importEmail(importable)

            if (result.imported) {
              folderImported++
              totalImported++
            } else {
              folderSkipped++
              totalSkipped++
            }
          } catch (err) {
            totalErrors++
            console.error(`[ImapSync] Error importing email UID ${fetched.uid}:`, err)
          }
        }

        // Update last sync time for this folder
        state.lastSyncPerFolder[folder] = syncStartTime.toISOString()

        if (folderImported > 0) {
          console.log(`[ImapSync] ${folder}: ${folderImported} imported, ${folderSkipped} skipped`)
        }
      } catch (err) {
        console.error(`[ImapSync] Error processing folder ${folder}:`, err)
        totalErrors++
      }
    }

    state.lastFullSync = syncStartTime.toISOString()
    saveState(state)
  } finally {
    try {
      await client.logout()
    } catch {
      // Ignore logout errors
    }
  }

  return { imported: totalImported, skipped: totalSkipped, errors: totalErrors }
}

/**
 * Start the IMAP sync background service
 * Runs every 5 minutes
 */
export function startImapSync(): void {
  if (!isImapConfigured()) {
    console.log('[ImapSync] IMAP not configured, sync disabled')
    return
  }

  console.log('[ImapSync] Starting IMAP sync service...')
  console.log(`[ImapSync] - Sync interval: ${SYNC_INTERVAL / 1000}s`)
  console.log(`[ImapSync] - EML backup: ${config.emlBackup.enabled ? 'enabled' : 'disabled'}`)

  // Run initial sync after a short delay (let server fully start)
  setTimeout(async () => {
    console.log('[ImapSync] Running initial sync...')
    try {
      const result = await syncEmails()
      if (result.imported > 0 || result.errors > 0) {
        console.log(`[ImapSync] Initial sync complete - Imported: ${result.imported}, Skipped: ${result.skipped}, Errors: ${result.errors}`)
      } else {
        console.log('[ImapSync] Initial sync complete - No new emails')
      }
    } catch (error) {
      console.error('[ImapSync] Error in initial sync:', error)
    }
  }, 5000) // 5 second delay

  // Then run on interval
  setInterval(async () => {
    try {
      const result = await syncEmails()
      if (result.imported > 0 || result.errors > 0) {
        console.log(`[ImapSync] Sync complete - Imported: ${result.imported}, Errors: ${result.errors}`)
      }
    } catch (error) {
      console.error('[ImapSync] Error during sync:', error)
    }
  }, SYNC_INTERVAL)

  console.log('[ImapSync] Sync service started')
}
