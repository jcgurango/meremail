<script setup lang="ts">
import { useOffline } from '~/composables/useOffline'
import {
  getCachedInboxThreads,
  getCachedReplyLaterThreads,
} from '~/composables/useOfflineThreadCache'
import type { CachedThread, OfflineThread } from '~/utils/offline-db'

interface Thread {
  type: 'thread' | 'draft'
  id: number
  subject: string
  latestEmailAt: string | null
  unreadCount: number
  totalCount: number
  draftCount?: number
  participants: { id: number; name: string | null; email: string; role: string }[]
  snippet: string
}

interface ThreadsResponse {
  threads: Thread[]
  hasMore: boolean
}

const props = defineProps<{
  bucket?: string
  replyLater?: boolean
  emptyMessage?: string
}>()

const { isOnline } = useOffline()

const threads = ref<Thread[]>([])
const hasMore = ref(false)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref<Error | null>(null)
const usingCache = ref(false)

function buildQuery(offset = 0) {
  const query: Record<string, string | number> = { offset }
  if (props.replyLater) {
    query.replyLater = 'true'
  } else if (props.bucket) {
    query.bucket = props.bucket
  }
  return query
}

// Convert cached thread data to display format
function cachedToThread(cached: OfflineThread): Thread {
  return {
    type: cached.type,
    id: cached.id,
    subject: cached.subject,
    latestEmailAt: cached.latestEmailAt ? new Date(cached.latestEmailAt).toISOString() : null,
    unreadCount: cached.unreadCount,
    totalCount: cached.totalCount,
    draftCount: cached.draftCount,
    participants: cached.participants,
    snippet: cached.snippet,
  }
}

// Convert cached reply-later thread to display format
function cachedReplyLaterToThread(cached: CachedThread): Thread {
  const latestEmail = cached.emails[0]
  return {
    type: 'thread',
    id: cached.id,
    subject: cached.subject,
    latestEmailAt: latestEmail?.sentAt ? new Date(latestEmail.sentAt).toISOString() : null,
    unreadCount: 0,
    totalCount: cached.emails.length,
    draftCount: cached.emails.filter((e: { status: string }) => e.status === 'draft').length,
    participants: latestEmail?.sender ? [latestEmail.sender] : [],
    snippet: latestEmail?.contentText?.substring(0, 150) || '',
  }
}

async function loadFromCache(): Promise<boolean> {
  try {
    if (props.replyLater) {
      const cachedThreads = await getCachedReplyLaterThreads()
      if (cachedThreads.length > 0) {
        threads.value = cachedThreads.map(cachedReplyLaterToThread)
        hasMore.value = false
        usingCache.value = true
        return true
      }
    } else if (props.bucket === 'approved' || !props.bucket) {
      const cachedThreads = await getCachedInboxThreads()
      if (cachedThreads.length > 0) {
        threads.value = cachedThreads.map(cachedToThread)
        hasMore.value = false // Disable "Load More" when using cache
        usingCache.value = true
        return true
      }
    }
    return false
  } catch (e) {
    console.error('[Offline] Failed to load from cache:', e)
    return false
  }
}

async function loadThreads() {
  loading.value = true
  error.value = null
  usingCache.value = false

  // If offline, load from cache (may be empty, that's okay)
  if (!isOnline.value) {
    await loadFromCache()
    loading.value = false
    return
  }

  try {
    const data = await $fetch<ThreadsResponse>('/api/threads', {
      query: buildQuery()
    })
    threads.value = data.threads
    hasMore.value = data.hasMore
  } catch (e) {
    // On network error, try to load from cache
    const loaded = await loadFromCache()
    if (!loaded) {
      error.value = e as Error
    }
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value || usingCache.value) return
  loadingMore.value = true
  try {
    const response = await $fetch<ThreadsResponse>('/api/threads', {
      query: buildQuery(threads.value.length)
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
  } else if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
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

await loadThreads()
</script>

<template>
  <div class="thread-list-container">
    <div v-if="loading" class="loading">Loading...</div>

    <div v-else-if="error" class="error">
      Failed to load threads: {{ error?.message }}
    </div>

    <div v-else-if="threads.length === 0" class="empty">
      {{ emptyMessage || 'No threads' }}
    </div>

    <div v-if="usingCache && !loading" class="cache-notice">
      Showing cached data (offline)
    </div>

    <ul v-if="threads.length > 0 && !loading" class="thread-list">
      <li
        v-for="thread in threads"
        :key="`${thread.type}-${thread.id}`"
        class="thread-item"
        :class="{
          unread: thread.unreadCount > 0,
          'is-draft': thread.type === 'draft'
        }"
      >
        <NuxtLink
          :to="thread.type === 'draft' ? `/draft/${thread.id}` : `/thread/${thread.id}`"
          class="thread-link"
        >
          <div class="thread-header">
            <span class="thread-participants">
              <span v-if="thread.type === 'draft'" class="draft-badge">Draft</span>
              {{ thread.type === 'draft' && thread.participants.length === 0
                ? 'New Message'
                : getParticipantDisplay(thread.participants) }}
            </span>
            <span class="thread-date">
              {{ formatDate(thread.latestEmailAt) }}
            </span>
          </div>
          <div class="thread-subject">
            {{ thread.subject }}
            <span v-if="thread.unreadCount > 0" class="unread-count">
              ({{ thread.unreadCount }})
            </span>
          </div>
          <div class="thread-snippet">
            {{ thread.snippet || '(No content)' }}
          </div>
        </NuxtLink>
      </li>
    </ul>

    <div v-if="hasMore && !loading" class="load-more">
      <button @click="loadMore" :disabled="loadingMore" class="load-more-btn">
        {{ loadingMore ? 'Loading...' : 'Load More' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
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

.thread-item.unread .thread-participants {
  font-weight: 700;
}

.thread-item.unread .thread-subject {
  font-weight: 700;
}

.thread-item:not(.unread) .thread-participants,
.thread-item:not(.unread) .thread-subject,
.thread-item:not(.unread) .thread-snippet {
  color: #888;
}

.thread-item:not(.unread) .thread-participants {
  font-weight: 500;
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

.thread-item.is-draft {
  background: #fffbeb;
}

.thread-item.is-draft:hover {
  background: #fef3c7;
}

.draft-badge {
  display: inline-block;
  padding: 2px 6px;
  margin-right: 6px;
  background: #f59e0b;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  border-radius: 3px;
  vertical-align: middle;
}

.cache-notice {
  padding: 8px 20px;
  background: #fef3c7;
  color: #92400e;
  font-size: 13px;
  text-align: center;
  border-bottom: 1px solid #fde68a;
}
</style>
