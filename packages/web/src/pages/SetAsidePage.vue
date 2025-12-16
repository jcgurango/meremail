<script setup lang="ts">
import { onMounted } from 'vue'
import SetAsideFeed from '@/components/SetAsideFeed.vue'
import FolderNav from '@/components/FolderNav.vue'

onMounted(() => {
  document.title = 'Set Aside - MereMail'
})
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>Set Aside</h1>
      <FolderNav active-queue="set_aside" />
    </header>

    <main class="main">
      <SetAsideFeed empty-message="No emails set aside. Use 'Send to' on a thread to set it aside." />
    </main>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding-bottom: 80px;
}

.header {
  padding: 24px 20px 16px;
  border-bottom: 1px solid #e5e5e5;
}

.header h1 {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0 0 16px 0;
}

.main {
  padding: 0;
}
</style>
