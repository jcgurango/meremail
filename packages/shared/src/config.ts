import dotenv from 'dotenv'
import { dirname, resolve, isAbsolute, join } from 'path'
import { fileURLToPath } from 'url'

// Calculate monorepo root from this file's location (3 levels up from packages/shared/src)
const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '../../..')

// Load .env from monorepo root
dotenv.config({ path: resolve(rootDir, '.env') })

function envStr(key: string, fallback?: string): string {
  const value = process.env[key]
  if (value !== undefined) return value
  if (fallback !== undefined) return fallback
  throw new Error(`Missing required environment variable: ${key}`)
}

function envInt(key: string, fallback?: number): number {
  const value = process.env[key]
  if (value !== undefined) {
    const parsed = parseInt(value, 10)
    if (isNaN(parsed)) throw new Error(`Invalid integer for ${key}: ${value}`)
    return parsed
  }
  if (fallback !== undefined) return fallback
  throw new Error(`Missing required environment variable: ${key}`)
}

function envBool(key: string, fallback?: boolean): boolean {
  const value = process.env[key]
  if (value !== undefined) {
    return value === 'true' || value === '1'
  }
  if (fallback !== undefined) return fallback
  throw new Error(`Missing required environment variable: ${key}`)
}

function envStrOptional(key: string): string | undefined {
  return process.env[key] || undefined
}

// Export rootDir for other modules to use
export { rootDir }

// Helper to resolve paths - if absolute, use as-is; if relative, resolve from rootDir
export function resolvePath(path: string): string {
  if (path.startsWith('/')) return path
  return resolve(rootDir, path)
}

export const config = {
  smtp: {
    host: envStr('SMTP_HOST', ''),
    port: envInt('SMTP_PORT', 587),
    user: envStr('SMTP_USER', ''),
    pass: envStr('SMTP_PASS', ''),
    secure: envBool('SMTP_SECURE', false),
  },
  imap: {
    host: envStr('IMAP_HOST', ''),
    port: envInt('IMAP_PORT', 993),
    user: envStr('IMAP_USER', ''),
    pass: envStr('IMAP_PASS', ''),
    secure: envBool('IMAP_SECURE', true),
  },
  defaultSender: {
    name: envStrOptional('DEFAULT_SENDER_NAME'),
    email: envStrOptional('DEFAULT_SENDER_EMAIL'),
  },
  database: {
    path: resolvePath(envStr('DATABASE_PATH', 'data/meremail.db')),
  },
  imageProxy: {
    // URL template with {url} placeholder for the encoded image URL
    // Set to empty string to disable proxying
    urlTemplate: envStr('IMAGE_PROXY_URL', 'https://images.weserv.nl/?url={url}'),
  },
  uploads: {
    // Maximum file size in bytes (default 20MB)
    maxSize: envInt('MAX_ATTACHMENT_SIZE', 20 * 1024 * 1024),
    // Directory for uploaded files
    path: resolvePath('data/uploads'),
  },
  emlBackup: {
    // Whether to backup raw EML files during IMAP import (default true)
    enabled: envBool('EML_BACKUP_ENABLED', true),
    // Directory for EML backups
    path: resolvePath('data/eml-backup'),
  },
} as const

export type Config = typeof config

/**
 * Resolve attachment file path - handles both absolute (imported) and relative (uploaded) paths.
 * Imported attachments store full absolute path, uploaded attachments store just the filename.
 */
export function resolveAttachmentPath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : join(config.uploads.path, filePath)
}
