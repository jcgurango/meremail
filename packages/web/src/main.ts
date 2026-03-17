import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import { routes } from './router'
import { isNative, getServerUrl } from './utils/native-config'
import { setApiBaseUrl } from './utils/api-url'

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// Auth state - cached to avoid checking on every navigation
let isAuthenticated: boolean | null = null

async function checkAuth(): Promise<boolean> {
  // Return cached value if we've already checked
  if (isAuthenticated !== null) {
    return isAuthenticated
  }

  try {
    const response = await fetch('/api/auth/me')
    isAuthenticated = response.ok
    return isAuthenticated
  } catch {
    isAuthenticated = false
    return false
  }
}

// Reset auth state (call after logout)
export function resetAuthState() {
  isAuthenticated = null
}

// Fetch interceptor for native platform
export function installFetchInterceptor(serverUrl: string) {
  const originalFetch = window.fetch
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (typeof input === 'string' && input.startsWith('/api')) {
      return originalFetch.call(window, serverUrl + input, init)
    }
    if (input instanceof Request && input.url.startsWith('/api')) {
      return originalFetch.call(window, new Request(serverUrl + input.url, input), init)
    }
    return originalFetch.call(window, input, init)
  }
}

// Navigation guard
router.beforeEach(async (to, _from, next) => {
  // On native, redirect to setup if no server URL configured
  if (isNative()) {
    const serverUrl = await getServerUrl()
    if (!serverUrl && to.name !== 'setup') {
      return next({ name: 'setup' })
    }
  }

  // Public routes don't need auth
  if (to.meta.public) {
    return next()
  }

  // Check authentication
  const authenticated = await checkAuth()

  if (!authenticated) {
    // Redirect to login, preserving intended destination
    return next({
      name: 'login',
      query: { redirect: to.fullPath },
    })
  }

  next()
})

// Initialize native platform before mounting
async function init() {
  if (isNative()) {
    const serverUrl = await getServerUrl()
    if (serverUrl) {
      setApiBaseUrl(serverUrl)
      installFetchInterceptor(serverUrl)
    }
  }

  const app = createApp(App)
  app.use(router)
  app.mount('#app')
}

init()
