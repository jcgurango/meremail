<script setup lang="ts">
const searchOpen = ref(false)
</script>

<template>
  <nav class="bottom-nav">
    <button class="nav-pill search" @click="searchOpen = true">
      <span class="nav-icon">🔍</span>
      <span class="nav-label">Search</span>
    </button>
    <NuxtLink to="/screener" class="nav-pill screener">
      <span class="nav-icon">👤</span>
      <span class="nav-label">Screener</span>
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

.nav-pill.screener {
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
</style>
