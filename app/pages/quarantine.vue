<script setup lang="ts">
useHead({ title: 'Quarantine - MereMail' })
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>Quarantine</h1>
      <nav class="tab-nav">
        <NuxtLink to="/" class="tab-pill">Inbox</NuxtLink>
        <NuxtLink to="/feed" class="tab-pill">Feed</NuxtLink>
        <NuxtLink to="/paper-trail" class="tab-pill">Paper Trail</NuxtLink>
        <NuxtLink to="/quarantine" class="tab-pill active">Quarantine</NuxtLink>
      </nav>
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

.tab-nav {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tab-pill {
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
