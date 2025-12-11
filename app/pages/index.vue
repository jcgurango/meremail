<script setup lang="ts">
useHead({ title: 'MereMail' })
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>Inbox</h1>
      <BucketNav />
    </header>

    <main class="main">
      <ThreadList bucket="approved" empty-message="No threads yet" />
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
