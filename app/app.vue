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

const { data: threads, pending, error } = await useFetch<Thread[]>('/api/threads')

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
  <div class="app">
    <header class="header">
      <h1>MereMail</h1>
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
        </li>
      </ul>
    </main>
  </div>
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

.app {
  max-width: 800px;
  margin: 0 auto;
  min-height: 100vh;
}

.header {
  padding: 24px 20px;
  border-bottom: 1px solid #e5e5e5;
}

.header h1 {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
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
}

.thread-item {
  padding: 16px 20px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
  transition: background-color 0.1s ease;
}

.thread-item:hover {
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
</style>
