<script setup lang="ts">
useHead({ title: 'Feed - MereMail' })
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>Feed</h1>
      <nav class="tab-nav">
        <NuxtLink to="/" class="tab-pill">Inbox</NuxtLink>
        <NuxtLink to="/feed" class="tab-pill active">Feed</NuxtLink>
        <NuxtLink to="/paper-trail" class="tab-pill">Paper Trail</NuxtLink>
      </nav>
    </header>

    <main class="main">
      <BucketFeed
        bucket="feed"
        empty-message="No feed emails yet. Mark contacts as &quot;Feed&quot; in the Screener."
      />
    </main>

    <BottomNav />
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

.main {
  padding: 0;
}
</style>
