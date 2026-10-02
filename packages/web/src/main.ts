import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import { routes } from './router'
import { checkAuth } from './auth'
import { startSync } from './local/sync'

const router = createRouter({
  history: createWebHistory(),
  routes,
})

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

  // Start syncing straight away, then keep going in the background. The app
  // shows what's stored locally and never waits for this. (No-op once running.)
  startSync()
  next()
})

const app = createApp(App)
app.use(router)
app.mount('#app')
