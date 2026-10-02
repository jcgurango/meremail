import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import { routes } from './router'
import { checkAuth } from './auth'
import { startSync } from './local/sync'

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    // Going back or forward: return to where the page was scrolled to. The
    // page is filled in from the local database just after it mounts, so wait
    // until it is tall enough and has stopped changing height.
    if (savedPosition) {
      return new Promise((resolve) => {
        const deadline = Date.now() + 1500
        let lastHeight = -1
        let stableFrames = 0
        const check = () => {
          const height = document.documentElement.scrollHeight
          stableFrames = height === lastHeight ? stableFrames + 1 : 0
          lastHeight = height
          const ready = height >= savedPosition.top + window.innerHeight && stableFrames >= 3
          if (ready || Date.now() > deadline) {
            resolve(savedPosition)
          } else {
            requestAnimationFrame(check)
          }
        }
        check()
      })
    }
    // Same page with a different query (e.g. typing a search): stay put
    if (to.path === from.path) return false
    return { top: 0 }
  },
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
