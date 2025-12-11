<script setup lang="ts">
const route = useRoute()

interface UnreadCounts {
  inbox: number
  feed: number
  paper_trail: number
  quarantine: number
  reply_later: number
}

const counts = ref<UnreadCounts>({
  inbox: 0,
  feed: 0,
  paper_trail: 0,
  quarantine: 0,
  reply_later: 0,
})

const tabs = [
  { path: '/', label: 'Inbox', key: 'inbox' as const },
  { path: '/reply-later', label: 'Reply Later', key: 'reply_later' as const },
  { path: '/feed', label: 'Feed', key: 'feed' as const },
  { path: '/paper-trail', label: 'Paper Trail', key: 'paper_trail' as const },
  { path: '/quarantine', label: 'Quarantine', key: 'quarantine' as const },
]

async function loadCounts() {
  try {
    const data = await $fetch<UnreadCounts>('/api/unread-counts')
    counts.value = data
  } catch (e) {
    console.error('Failed to load unread counts:', e)
  }
}

// Load on mount
onMounted(() => {
  loadCounts()
})

// Refresh when navigating between bucket pages
watch(() => route.path, () => {
  if (['/', '/reply-later', '/feed', '/paper-trail', '/quarantine'].includes(route.path)) {
    loadCounts()
  }
})
</script>

<template>
  <nav class="tab-nav">
    <NuxtLink
      v-for="tab in tabs"
      :key="tab.path"
      :to="tab.path"
      class="tab-pill"
      :class="{ active: route.path === tab.path }"
    >
      {{ tab.label }}
      <span v-if="counts[tab.key] > 0" class="pill-count">{{ counts[tab.key] }}</span>
    </NuxtLink>
  </nav>
</template>

<style scoped>
.tab-nav {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tab-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid #e5e5e5;
  border-radius: 20px;
  background: #fff;
  font-size: 14px;
  font-weight: 500;
  color: #666;
  text-decoration: none;
  transition: all 0.15s;
}

.tab-pill:hover {
  border-color: #ccc;
  color: #333;
}

.tab-pill.active {
  background: #1a1a1a;
  border-color: #1a1a1a;
  color: #fff;
}

.pill-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  background: #ef4444;
  color: #fff;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
}

.tab-pill.active .pill-count {
  background: #fff;
  color: #1a1a1a;
}
</style>
