import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import { routes } from './router'

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

// Navigation guard
router.beforeEach(async (to, _from, next) => {
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

const app = createApp(App)
app.use(router)
app.mount('#app')
