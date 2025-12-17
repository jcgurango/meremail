import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { resolvePath, cleanupExpiredItems } from '@meremail/shared'
import { createBackup, cleanupOldBackups } from '../cli/backup'

// State file to track last run
const STATE_FILE = resolvePath('data/.daily-scheduler-state.json')

// Configuration
const BACKUP_RETENTION_DAYS = 7
const CHECK_INTERVAL = 60 * 60 * 1000 // Check every hour

interface SchedulerState {
  lastBackupDate: string | null
  lastRetentionCleanupDate: string | null
}

function loadState(): SchedulerState {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
    }
  } catch (error) {
    console.error('[DailyScheduler] Error loading state:', error)
  }
  return { lastBackupDate: null, lastRetentionCleanupDate: null }
}

function saveState(state: SchedulerState): void {
  try {
    const dir = dirname(STATE_FILE)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  } catch (error) {
    console.error('[DailyScheduler] Error saving state:', error)
  }
}

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0]!
}

/**
 * Run the daily backup task
 */
async function runDailyBackup(): Promise<void> {
  console.log('[DailyScheduler] Running daily database backup...')

  const backupResult = createBackup()
  if (backupResult.success) {
    console.log(`[DailyScheduler] Backup created: ${backupResult.path}`)
  } else {
    console.error('[DailyScheduler] Backup failed:', backupResult.error)
    return
  }

  const cleanupResult = cleanupOldBackups(undefined, BACKUP_RETENTION_DAYS)
  console.log(`[DailyScheduler] Cleanup: ${cleanupResult.deleted} old backups removed`)
}

/**
 * Run the daily retention cleanup task
 * Permanently deletes items in Trash and Junk folders older than 30 days
 */
async function runRetentionCleanup(): Promise<void> {
  console.log('[DailyScheduler] Running retention cleanup...')

  try {
    const result = await cleanupExpiredItems()
    console.log(`[DailyScheduler] Retention cleanup: ${result.threadsDeleted} threads, ${result.emailsDeleted} emails, ${result.attachmentsDeleted} attachments deleted`)
    if (result.errors.length > 0) {
      console.error('[DailyScheduler] Retention cleanup errors:', result.errors)
    }
  } catch (error) {
    console.error('[DailyScheduler] Retention cleanup failed:', error)
  }
}

/**
 * Check and run daily tasks if they haven't run today
 */
async function checkAndRunDailyTasks(): Promise<void> {
  const state = loadState()
  const today = getTodayDate()
  let stateChanged = false

  // Run backup if not done today
  if (state.lastBackupDate !== today) {
    await runDailyBackup()
    state.lastBackupDate = today
    stateChanged = true
  }

  // Run retention cleanup if not done today
  if (state.lastRetentionCleanupDate !== today) {
    await runRetentionCleanup()
    state.lastRetentionCleanupDate = today
    stateChanged = true
  }

  if (stateChanged) {
    saveState(state)
  }
}

/**
 * Start the daily scheduler
 * Checks every hour if daily tasks need to run
 */
export function startDailyScheduler(): void {
  console.log('[DailyScheduler] Starting daily scheduler...')
  console.log(`[DailyScheduler] - Backup retention: ${BACKUP_RETENTION_DAYS} days`)

  // Check immediately on startup
  checkAndRunDailyTasks().catch(err => {
    console.error('[DailyScheduler] Error in initial check:', err)
  })

  // Then check every hour
  setInterval(() => {
    checkAndRunDailyTasks().catch(err => {
      console.error('[DailyScheduler] Error checking daily tasks:', err)
    })
  }, CHECK_INTERVAL)

  console.log('[DailyScheduler] Scheduler started (checking hourly)')
}
