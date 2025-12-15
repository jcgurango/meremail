<script setup lang="ts">
import { onMounted } from 'vue'
import BucketNav from '@/components/BucketNav.vue'
import ThreadList from '@/components/ThreadList.vue'

onMounted(() => {
  document.title = 'Quarantine - MereMail'
})
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>Quarantine</h1>
      <BucketNav />
    </header>

    <div class="quarantine-warning">
      Emails in quarantine will be automatically deleted after 30 days.
      To keep an email, move the sender to another bucket.
    </div>

    <main class="main">
      <ThreadList bucket="quarantine" empty-message="No quarantined threads" />
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

.quarantine-warning {
  margin: 16px 20px;
  padding: 12px 16px;
  background: #fef3c7;
  border: 1px solid #f59e0b;
  border-radius: 8px;
  font-size: 14px;
  color: #92400e;
  line-height: 1.5;
}

.main {
  padding: 0;
}
</style>
