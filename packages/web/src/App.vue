<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SyncFailures from '@/components/SyncFailures.vue'
import BottomNav from '@/components/BottomNav.vue'
import { useOffline, setNavigationHandler, initializeNotifications } from '@/composables/useOffline'
import { onAuthRequired } from '@/local/sync'
import { resetAuthState } from '@/auth'

const route = useRoute()
const router = useRouter()

const showBottomNav = computed(() => {
  // Show on main pages and any folder route
  if (['/', '/reply-later', '/set-aside', '/rules', '/folders', '/contacts', '/attachments'].includes(route.path)) return true
  if (route.path.startsWith('/folder/')) return true
  return false
})

onMounted(async () => {
  // Set up navigation handler for service worker notifications
  setNavigationHandler((url: string) => {
    router.push(url)
  })

  // Listen for service worker messages (sync requests, notification clicks)
  useOffline()

  // If the session has expired, sync can't continue until the user logs in again
  onAuthRequired(() => {
    resetAuthState()
    if (route.name !== 'login') {
      router.push({ name: 'login', query: { redirect: route.fullPath } })
    }
  })

  // Initialize notifications (request permission and register periodic sync)
  try {
    await initializeNotifications()
  } catch (e) {
    console.error('Failed to initialize notifications:', e)
  }
})
</script>

<template>
  <div class="app-wrapper">
    <RouterView />
    <SyncFailures />
    <BottomNav v-if="showBottomNav" />
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen,
    Ubuntu, Cantarell, sans-serif;
  font-size: 15px;
  line-height: 1.5;
  color: #1a1a1a;
  background: #fff;
  -webkit-font-smoothing: antialiased;
}

.app-wrapper {
  position: relative;
}
</style>
