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
    path: envStr('DATABASE_PATH', './data/meremail.db'),
  },
} as const

export type Config = typeof config
