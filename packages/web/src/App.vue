<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import OfflineIndicator from '@/components/OfflineIndicator.vue'
import BottomNav from '@/components/BottomNav.vue'
import { setNavigationHandler, initializeNotifications } from '@/composables/useOffline'

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

  // Initialize new sync system (proactively fetches all data)
  try {
    const { initializeSync } = await import('@/composables/useSyncInit')
    initializeSync()
  } catch (e) {
    console.error('Failed to initialize sync:', e)
  }

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
    <OfflineIndicator class="offline-indicator-fixed" />
    <RouterView />
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

.offline-indicator-fixed {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 1000;
}
</style>
