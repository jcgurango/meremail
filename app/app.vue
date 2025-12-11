<script setup lang="ts">
const route = useRoute()

const showBottomNav = computed(() => {
  return ['/', '/reply-later', '/feed', '/paper-trail', '/quarantine'].includes(route.path)
})
</script>

<template>
  <NuxtPage />
  <BottomNav v-if="showBottomNav" />
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
</style>
