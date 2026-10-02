import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { randomBytes } from 'crypto'
import { rootDir } from '@meremail/shared/config'

/**
 * Set a new login password in the root .env file.
 *
 * Usage:
 *   pnpm auth:reset-password              # generate a random password
 *   pnpm auth:reset-password <password>   # use the given password
 *
 * The cookie secret is rotated as well, so existing sessions are logged out.
 * The server reads these at startup - restart it afterwards.
 */

function setEnvValue(contents: string, key: string, value: string): string {
  const line = `${key}=${value}`
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  if (pattern.test(contents)) {
    return contents.replace(pattern, () => line)
  }
  return `${contents}${contents === '' || contents.endsWith('\n') ? '' : '\n'}${line}\n`
}

function main() {
  const provided = process.argv[2]
  if (provided === '--help' || provided === '-h') {
    console.log('Usage: pnpm auth:reset-password [password]')
    console.log('')
    console.log('Sets AUTH_PASSWORD in .env (a random one if none is given) and rotates')
    console.log('AUTH_COOKIE_SECRET so existing sessions are logged out.')
    process.exit(0)
  }
  if (provided !== undefined && (provided.length === 0 || /[\r\n]/.test(provided))) {
    console.error('Error: the password must be a single non-empty line')
    process.exit(1)
  }

  const envPath = resolve(rootDir, '.env')
  const password = provided ?? randomBytes(15).toString('base64url')

  let contents = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : ''
  contents = setEnvValue(contents, 'AUTH_PASSWORD', password)
  contents = setEnvValue(contents, 'AUTH_COOKIE_SECRET', randomBytes(32).toString('hex'))
  writeFileSync(envPath, contents, { mode: 0o600 })

  const username = contents.match(/^AUTH_USERNAME=(.*)$/m)?.[1] || 'admin'

  console.log(`Updated ${envPath}`)
  console.log(`  Username: ${username}`)
  if (provided === undefined) {
    console.log(`  Password: ${password}`)
  }
  console.log('')
  console.log('Restart the server for this to take effect. Existing sessions will be logged out.')
  console.log('If AUTH_PASSWORD is set through the environment instead (e.g. Docker), change it there.')
}

main()
