<script setup lang="ts">
const searchOpen = ref(false)

// Fetch unscreened count
const unscreenedCount = ref(0)

async function loadUnscreenedCount() {
  try {
    const data = await $fetch<{ counts: Record<string, number> }>('/api/contacts?limit=1')
    unscreenedCount.value = data.counts.unsorted || 0
  } catch (e) {
    console.error('Failed to load unscreened count:', e)
  }
}

// Load on mount
onMounted(() => {
  loadUnscreenedCount()
})
</script>

<template>
  <nav class="bottom-nav">
    <button class="nav-pill search" @click="searchOpen = true">
      <span class="nav-icon">🔍</span>
      <span class="nav-label">Search</span>
    </button>
    <NuxtLink to="/contacts" class="nav-pill contacts">
      <span class="nav-icon">👤</span>
      <span class="nav-label">Contacts</span>
      <span v-if="unscreenedCount > 0" class="nav-badge">{{ unscreenedCount }}</span>
    </NuxtLink>
    <NuxtLink to="/attachments" class="nav-pill attachments">
      <span class="nav-icon">📎</span>
      <span class="nav-label">Attachments</span>
    </NuxtLink>
  </nav>

  <SearchModal :open="searchOpen" @close="searchOpen = false" />
</template>

<style scoped>
.bottom-nav {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 12px;
  padding: 8px;
  background: #fff;
  border-radius: 24px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  z-index: 100;
}

.nav-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 20px;
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  transition: transform 0.15s, box-shadow 0.15s;
}

.nav-pill:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.nav-pill.search {
  background: #f3e8ff;
  color: #7c3aed;
  border: none;
  cursor: pointer;
}

.nav-pill.contacts {
  background: #e0f2fe;
  color: #0369a1;
}

.nav-pill.attachments {
  background: #fef3c7;
  color: #b45309;
}

.nav-icon {
  font-size: 16px;
}

.nav-label {
  font-weight: 500;
}

.nav-badge {
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
</style>
