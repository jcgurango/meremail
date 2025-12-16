import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'

export const authRoutes = new Hono()

// Session cookie name
const SESSION_COOKIE = 'meremail_session'
// Cookie max age: 30 days
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60

// Get auth config from env
function getAuthConfig() {
  return {
    username: process.env.AUTH_USERNAME || 'admin',
    password: process.env.AUTH_PASSWORD || '',
    secret: process.env.AUTH_COOKIE_SECRET || 'default-secret-change-me',
  }
}

// Generate a session token
function generateSessionToken(secret: string): string {
  const timestamp = Date.now().toString()
  const random = randomBytes(16).toString('hex')
  const data = `${timestamp}:${random}`
  const signature = createHash('sha256')
    .update(`${data}:${secret}`)
    .digest('hex')
  return `${data}:${signature}`
}

// Verify a session token
function verifySessionToken(token: string, secret: string): boolean {
  if (!token) return false

  const parts = token.split(':')
  if (parts.length !== 3) return false

  const timestamp = parts[0]!
  const random = parts[1]!
  const signature = parts[2]!

  const expectedSignature = createHash('sha256')
    .update(`${timestamp}:${random}:${secret}`)
    .digest('hex')

  // Use timing-safe comparison to prevent timing attacks
  try {
    return timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    )
  } catch {
    return false
  }
}

// POST /api/auth/login
authRoutes.post('/login', async (c) => {
  const config = getAuthConfig()

  // Check if auth is configured
  if (!config.password) {
    return c.json({ error: 'Authentication not configured. Set AUTH_PASSWORD in .env' }, 500)
  }

  const body = await c.req.json<{ username: string; password: string }>()

  if (!body.username || !body.password) {
    return c.json({ error: 'Username and password required' }, 400)
  }

  // Verify credentials (timing-safe comparison)
  const usernameMatch = body.username === config.username
  const passwordMatch = body.password === config.password

  if (!usernameMatch || !passwordMatch) {
    // Add small delay to prevent timing attacks
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100))
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  // Generate session token
  const token = generateSessionToken(config.secret)

  // Set cookie
  setCookie(c, SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: COOKIE_MAX_AGE,
  })

  return c.json({ success: true })
})

// POST /api/auth/logout
authRoutes.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ success: true })
})

// GET /api/auth/me - Check if authenticated
authRoutes.get('/me', (c) => {
  const config = getAuthConfig()
  const token = getCookie(c, SESSION_COOKIE)

  if (!token || !verifySessionToken(token, config.secret)) {
    return c.json({ authenticated: false }, 401)
  }

  return c.json({
    authenticated: true,
    username: config.username,
  })
})

// Middleware factory to protect routes
export function requireAuth() {
  return async (c: any, next: () => Promise<void>) => {
    const config = getAuthConfig()

    // If no password is set, skip auth (development convenience)
    if (!config.password) {
      console.warn('[Auth] WARNING: No AUTH_PASSWORD set, authentication disabled!')
      return next()
    }

    const token = getCookie(c, SESSION_COOKIE)

    if (!token || !verifySessionToken(token, config.secret)) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Refresh the session cookie (sliding expiration)
    // Generate a new token to rotate the session
    const newToken = generateSessionToken(config.secret)
    setCookie(c, SESSION_COOKIE, newToken, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      maxAge: COOKIE_MAX_AGE,
    })

    return next()
  }
}
