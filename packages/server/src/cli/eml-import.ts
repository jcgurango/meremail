import 'dotenv/config'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, extname } from 'path'
import { parseEml, importEmail, db, emails, resolvePath } from '@meremail/shared'

/**
 * Recursively find all .eml files in a directory
 */
function findEmlFiles(dir: string, recursive: boolean = true): string[] {
  const files: string[] = []

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)

    if (stat.isFile() && extname(entry).toLowerCase() === '.eml') {
      files.push(fullPath)
    } else if (recursive && stat.isDirectory()) {
      files.push(...findEmlFiles(fullPath, recursive))
    }
  }

  return files
}

async function main() {
  console.log('EML File Importer')
  console.log('=================\n')

  // Parse command line arguments
  const args = process.argv.slice(2)

  // Help
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log('Usage: pnpm mail:eml-import <folder> [options]')
    console.log('')
    console.log('Options:')
    console.log('  --sent         Mark emails as sent (from user)')
    console.log('  --junk         Mark emails as junk/spam')
    console.log('  --read         Mark emails as read')
    console.log('  --no-recursive Do not recurse into subdirectories')
    console.log('  --dry-run      Show what would be imported without importing')
    console.log('')
    console.log('Examples:')
    console.log('  pnpm mail:eml-import ~/backups/emails')
    console.log('  pnpm mail:eml-import ~/backups/sent --sent')
    console.log('  pnpm mail:eml-import ~/backups/spam --junk')
    process.exit(0)
  }

  const folder = args.find(a => !a.startsWith('--'))
  if (!folder) {
    console.error('Error: Please provide a folder path')
    process.exit(1)
  }

  const isSent = args.includes('--sent')
  const isJunk = args.includes('--junk')
  const isRead = args.includes('--read')
  const recursive = !args.includes('--no-recursive')
  const dryRun = args.includes('--dry-run')

  console.log(`Folder: ${folder}`)
  console.log(`Options: ${isSent ? 'sent ' : ''}${isJunk ? 'junk ' : ''}${isRead ? 'read ' : ''}${recursive ? 'recursive ' : 'non-recursive '}${dryRun ? 'dry-run' : ''}`)
  console.log('')

  // Find all EML files
  console.log('Scanning for .eml files...')
  let emlFiles: string[]
  try {
    emlFiles = findEmlFiles(resolvePath(folder), recursive)
  } catch (err) {
    console.error(`Error scanning folder: ${err}`)
    process.exit(1)
  }

  console.log(`Found ${emlFiles.length} .eml files\n`)

  if (emlFiles.length === 0) {
    console.log('No .eml files found.')
    process.exit(0)
  }

  if (dryRun) {
    console.log('Dry run - no emails will be imported.\n')
    for (const file of emlFiles.slice(0, 10)) {
      console.log(`  Would import: ${file}`)
    }
    if (emlFiles.length > 10) {
      console.log(`  ... and ${emlFiles.length - 10} more`)
    }
    process.exit(0)
  }

  let imported = 0
  let skipped = 0
  let errors = 0

  for (const file of emlFiles) {
    try {
      const raw = readFileSync(file)
      const importable = await parseEml(raw, { isSent, isJunk, isRead })
      const result = await importEmail(importable)

      if (result.imported) {
        imported++
        if (imported % 100 === 0) {
          console.log(`  Progress: ${imported} imported, ${skipped} skipped, ${errors} errors...`)
        }
      } else {
        skipped++
      }
    } catch (err) {
      errors++
      console.error(`  Error importing ${file}:`, err instanceof Error ? err.message : err)
    }
  }

  console.log('\n--- Import Summary ---')
  console.log(`Imported: ${imported}`)
  console.log(`Skipped (duplicates): ${skipped}`)
  console.log(`Errors: ${errors}`)

  const emailCount = db.select().from(emails).all().length
  console.log(`\nTotal emails in database: ${emailCount}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
