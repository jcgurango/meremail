<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import OfflineIndicator from '@/components/OfflineIndicator.vue'
import BottomNav from '@/components/BottomNav.vue'

const route = useRoute()

const showBottomNav = computed(() => {
  return ['/', '/reply-later', '/set-aside', '/feed', '/paper-trail', '/quarantine'].includes(route.path)
})

onMounted(async () => {
  try {
    const { initializeOfflineCache } = await import('@/composables/useOfflineInit')
    initializeOfflineCache()
  } catch (e) {
    console.error('Failed to initialize offline cache:', e)
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
