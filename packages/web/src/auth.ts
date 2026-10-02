/**
 * Whether the user is logged in.
 *
 * The server is the authority, but the app has to open without it. So the
 * last known answer is remembered, and used when the server can't be reached.
 */

const STORAGE_KEY = 'meremail-authenticated'

// Cached to avoid checking on every navigation
let isAuthenticated: boolean | null = null

export async function checkAuth(): Promise<boolean> {
  // Return cached value if we've already checked
  if (isAuthenticated !== null) {
    return isAuthenticated
  }

  try {
    const response = await fetch('/api/auth/me')
    isAuthenticated = response.ok
    localStorage.setItem(STORAGE_KEY, String(isAuthenticated))
  } catch {
    // Offline - go by what we knew last time, without caching it for the session
    return localStorage.getItem(STORAGE_KEY) === 'true'
  }

  return isAuthenticated
}

// Reset auth state (call after logout, or when the server rejects the session)
export function resetAuthState() {
  isAuthenticated = null
  localStorage.removeItem(STORAGE_KEY)
}
