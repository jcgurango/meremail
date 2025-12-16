import { existsSync, mkdirSync, copyFileSync, readdirSync, unlinkSync, statSync } from 'fs'
import { resolve, basename } from 'path'
import { config, resolvePath } from '@meremail/shared'

// Default backup location
const DEFAULT_BACKUP_DIR = resolvePath('data/backups')

// Retention period in days
const DEFAULT_RETENTION_DAYS = 7

/**
 * Create a timestamped backup of the database
 */
export function createBackup(backupDir: string = DEFAULT_BACKUP_DIR): { success: boolean; path?: string; error?: string } {
  const dbPath = config.database.path

  if (!existsSync(dbPath)) {
    return { success: false, error: `Database not found at ${dbPath}` }
  }

  // Ensure backup directory exists
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true })
  }

  // Create timestamped backup filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dbName = basename(dbPath, '.db')
  const backupPath = resolve(backupDir, `${dbName}-${timestamp}.db`)

  try {
    copyFileSync(dbPath, backupPath)
    console.log(`Backup created: ${backupPath}`)
    return { success: true, path: backupPath }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: message }
  }
}

/**
 * Remove backups older than retention period
 */
export function cleanupOldBackups(backupDir: string = DEFAULT_BACKUP_DIR, retentionDays: number = DEFAULT_RETENTION_DAYS): { deleted: number; errors: number } {
  if (!existsSync(backupDir)) {
    return { deleted: 0, errors: 0 }
  }

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays)

  let deleted = 0
  let errors = 0

  const files = readdirSync(backupDir)
  for (const file of files) {
    if (!file.endsWith('.db')) continue

    const filePath = resolve(backupDir, file)
    try {
      const stats = statSync(filePath)
      if (stats.mtime < cutoffDate) {
        unlinkSync(filePath)
        deleted++
        console.log(`Deleted old backup: ${file}`)
      }
    } catch (error) {
      console.error(`Failed to process ${file}:`, error)
      errors++
    }
  }

  return { deleted, errors }
}

/**
 * Run backup with cleanup
 */
export function runBackupWithCleanup(backupDir?: string, retentionDays?: number): void {
  console.log('Starting database backup...')

  const backupResult = createBackup(backupDir)
  if (!backupResult.success) {
    console.error('Backup failed:', backupResult.error)
    process.exit(1)
  }

  console.log('Cleaning up old backups...')
  const cleanupResult = cleanupOldBackups(backupDir, retentionDays)
  console.log(`Cleanup complete: ${cleanupResult.deleted} deleted, ${cleanupResult.errors} errors`)
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  runBackupWithCleanup()
}
