<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { db } from '@/local/db'
import { useLiveQuery } from '@/local/live'
import { listFolderThreads, listReplyLater, type ThreadListItem } from '@/local/queries'
import { getWatermark } from '@/local/store'
import { isSyncing, loadOlderThreads } from '@/local/sync'
import { formatListDate } from '@/utils/format'

const props = defineProps<{
  folderId?: number
  queue?: 'reply_later'
  emptyMessage?: string
  unreadOnly?: boolean
}>()

// Folders that aren't kept offline are browsed straight from the server:
// each visit pages in from the top, and this is how far back it has got.
// Null until the first page has arrived.
const browsedTo = ref<number | null>(null)
const loadingMore = ref(false)
const loadMoreError = ref<string | null>(null)

interface ListState {
  threads: ThreadListItem[]
  /** Whether the server may have older threads than the ones shown */
  hasMore: boolean
  keptOffline: boolean
}

const { data: list, loaded } = useLiveQuery<ListState>(async () => {
  if (props.queue === 'reply_later') {
    // Everything in the queue is always held locally
    return { threads: await listReplyLater(), hasMore: false, keptOffline: true }
  }

  const folderId = props.folderId ?? 1
  const folder = await db.folders.get(folderId)
  const keptOffline = folder?.syncOffline !== false

  if (keptOffline) {
    const watermark = await getWatermark(folderId)
    return {
      threads: await listFolderThreads(folderId, { unreadOnly: props.unreadOnly }),
      hasMore: watermark > 0,
      keptOffline,
    }
  }

  // Until the first page arrives (or if we're offline), show whatever happens to be held
  return {
    threads: await listFolderThreads(folderId, { from: browsedTo.value ?? 0, unreadOnly: props.unreadOnly }),
    hasMore: browsedTo.value === null || browsedTo.value > 0,
    keptOffline,
  }
}, { threads: [], hasMore: false, keptOffline: true }, [browsedTo])

const threads = computed(() => list.value.threads)

async function loadMore() {
  if (loadingMore.value || props.folderId === undefined) return
  loadingMore.value = true
  loadMoreError.value = null

  try {
    if (list.value.keptOffline) {
      await loadOlderThreads(props.folderId, await getWatermark(props.folderId), { remember: true })
    } else {
      browsedTo.value = (await loadOlderThreads(props.folderId, browsedTo.value, { remember: false })) ?? 0
    }
  } catch (e) {
    console.error('Failed to load more threads:', e)
    loadMoreError.value = 'Older mail couldn\'t be loaded. It needs a connection to the server.'
  } finally {
    loadingMore.value = false
  }
}

function getParticipantDisplay(participants: ThreadListItem['participants']): string {
  if (participants.length === 0) return 'Unknown'
  const names = participants
    .slice(0, 3)
    .map((p) => p.name || p.email.split('@')[0])
  if (participants.length > 3) {
    return `${names.join(', ')} +${participants.length - 3}`
  }
  return names.join(', ')
}

onMounted(async () => {
  if (props.folderId === undefined) return
  const folder = await db.folders.get(props.folderId)
  if (folder && !folder.syncOffline) {
    loadMore()
  }
})
</script>

<template>
  <div class="thread-list-container">
    <div v-if="!loaded" class="loading">Loading...</div>

    <div v-else-if="threads.length === 0 && (isSyncing || loadingMore)" class="loading">
      Syncing...
    </div>

    <div v-else-if="threads.length === 0 && !list.hasMore" class="empty">
      {{ emptyMessage || 'No threads' }}
    </div>

    <ul v-if="threads.length > 0" class="thread-list">
      <li
        v-for="thread in threads"
        :key="`${thread.type}-${thread.id}`"
        class="thread-item"
        :class="{
          unread: thread.unreadCount > 0,
          'is-draft': thread.type === 'draft' && thread.draftCount > 0,
          'is-queued': thread.queuedCount > 0,
          'has-draft': thread.type !== 'draft' && thread.draftCount > 0
        }"
      >
        <RouterLink
          :to="thread.type === 'draft' ? `/draft/${thread.id}` : `/thread/${thread.id}`"
          class="thread-link"
        >
          <div class="thread-header">
            <span class="thread-participants">
              <span v-if="thread.queuedCount > 0" class="queued-badge">Queued</span>
              <span v-else-if="thread.type === 'draft'" class="draft-badge">Draft</span>
              {{ thread.type === 'draft' && thread.participants.length === 0
                ? 'New Message'
                : getParticipantDisplay(thread.participants) }}
              <span v-if="thread.type !== 'draft' && thread.draftCount > 0" class="has-draft-indicator">Draft</span>
            </span>
            <span class="thread-date">
              {{ formatListDate(thread.latestAt) }}
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
        </RouterLink>
      </li>
    </ul>

    <div v-if="loadMoreError" class="cache-notice">
      {{ loadMoreError }}
    </div>

    <div v-if="loaded && list.hasMore && !(threads.length === 0 && loadingMore)" class="load-more">
      <button @click="loadMore" :disabled="loadingMore" class="load-more-btn">
        {{ loadingMore ? 'Loading...' : 'Load older' }}
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

.queued-badge {
  display: inline-block;
  padding: 2px 6px;
  margin-right: 6px;
  background: #3b82f6;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  border-radius: 3px;
  vertical-align: middle;
}

.thread-item.is-queued {
  background: #eff6ff;
}

.thread-item.is-queued:hover {
  background: #dbeafe;
}

.thread-item.has-draft {
  border-left: 3px solid #f59e0b;
}

.has-draft-indicator {
  display: inline-block;
  padding: 1px 5px;
  margin-left: 6px;
  background: transparent;
  color: #b45309;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  border: 1px solid #f59e0b;
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
