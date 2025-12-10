<script setup lang="ts">
interface Thread {
  id: number
  subject: string
  latestEmailAt: string | null
  unreadCount: number
  totalCount: number
  participants: { id: number; name: string | null; email: string; role: string }[]
  snippet: string
}

interface ThreadsResponse {
  threads: Thread[]
  hasMore: boolean
}

const threads = ref<Thread[]>([])
const hasMore = ref(false)
const pending = ref(true)
const loadingMore = ref(false)
const error = ref<Error | null>(null)

// Initial load - show all threads, not just unread
const { data, error: fetchError } = await useFetch<ThreadsResponse>('/api/threads')
if (fetchError.value) {
  error.value = fetchError.value
} else if (data.value) {
  threads.value = data.value.threads
  hasMore.value = data.value.hasMore
}
pending.value = false

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const response = await $fetch<ThreadsResponse>('/api/threads', {
      query: { offset: threads.value.length }
    })
    threads.value = [...threads.value, ...response.threads]
    hasMore.value = response.hasMore
  } catch (e) {
    console.error('Failed to load more threads:', e)
  } finally {
    loadingMore.value = false
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } else if (days === 1) {
    return 'Yesterday'
  } else if (days < 7) {
    return date.toLocaleDateString([], { weekday: 'short' })
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }
}

function getParticipantDisplay(participants: Thread['participants']): string {
  if (participants.length === 0) return 'Unknown'
  const names = participants
    .slice(0, 3)
    .map((p) => p.name || p.email.split('@')[0])
  if (participants.length > 3) {
    return `${names.join(', ')} +${participants.length - 3}`
  }
  return names.join(', ')
}
</script>

<template>
  <div>
    <header class="header">
      <h1>MereMail</h1>
      <nav class="nav">
        <NuxtLink to="/screener" class="nav-link">Screener</NuxtLink>
        <NuxtLink to="/attachments" class="nav-link">Attachments</NuxtLink>
      </nav>
    </header>

    <main class="main">
      <div v-if="pending" class="loading">Loading...</div>

      <div v-else-if="error" class="error">
        Failed to load threads: {{ error.message }}
      </div>

      <div v-else-if="threads && threads.length === 0" class="empty">
        No unread threads
      </div>

      <ul v-else class="thread-list">
        <li v-for="thread in threads" :key="thread.id" class="thread-item">
          <NuxtLink :to="`/thread/${thread.id}`" class="thread-link">
            <div class="thread-header">
              <span class="thread-participants">
                {{ getParticipantDisplay(thread.participants) }}
              </span>
              <span class="thread-date">
                {{ formatDate(thread.latestEmailAt) }}
              </span>
            </div>
            <div class="thread-subject">
              {{ thread.subject }}
              <span v-if="thread.unreadCount > 1" class="unread-count">
                ({{ thread.unreadCount }})
              </span>
            </div>
            <div class="thread-snippet">
              {{ thread.snippet }}
            </div>
          </NuxtLink>
        </li>
      </ul>

      <div v-if="hasMore && !pending" class="load-more">
        <button @click="loadMore" :disabled="loadingMore" class="load-more-btn">
          {{ loadingMore ? 'Loading...' : 'Load More' }}
        </button>
      </div>
    </main>
  </div>
</template>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 20px;
  border-bottom: 1px solid #e5e5e5;
}

.header h1 {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0;
}

.nav {
  display: flex;
  gap: 16px;
}

.nav-link {
  color: #666;
  text-decoration: none;
  font-size: 14px;
}

.nav-link:hover {
  color: #000;
}

.main {
  padding: 0;
}

.loading,
.error,
.empty {
  padding: 40px 20px;
  text-align: center;
  color: #666;
}

.error {
  color: #991b1b;
}

.thread-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.thread-item {
  border-bottom: 1px solid #f0f0f0;
}

.thread-link {
  display: block;
  padding: 16px 20px;
  text-decoration: none;
  color: inherit;
  transition: background-color 0.1s ease;
}

.thread-link:hover {
  background-color: #fafafa;
}

.thread-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 4px;
}

.thread-participants {
  font-weight: 600;
  font-size: 14px;
  color: #1a1a1a;
}

.thread-date {
  font-size: 12px;
  color: #888;
  flex-shrink: 0;
  margin-left: 12px;
}

.thread-subject {
  font-size: 14px;
  color: #333;
  margin-bottom: 4px;
  font-weight: 500;
}

.unread-count {
  font-weight: 400;
  color: #666;
}

.thread-snippet {
  font-size: 13px;
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.load-more {
  padding: 24px 20px;
  text-align: center;
  border-top: 1px solid #f0f0f0;
}

.load-more-btn {
  padding: 10px 24px;
  font-size: 14px;
  font-weight: 500;
  color: #333;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.load-more-btn:hover:not(:disabled) {
  background: #fafafa;
  border-color: #ccc;
}

.load-more-btn:disabled {
  color: #999;
  cursor: not-allowed;
}
</style>
