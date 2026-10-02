<script setup lang="ts">
import { computed, watch, ref } from 'vue'
import { RouterLink } from 'vue-router'
import ThreadList from '@/components/ThreadList.vue'
import FolderNav from '@/components/FolderNav.vue'
import SearchToolbar, { type SearchFilters } from '@/components/SearchToolbar.vue'
import { db } from '@/local/db'
import { useLiveQuery } from '@/local/live'
import { enqueue } from '@/local/actions'
import { searchLocal, searchServer, mergeResults, type EmailSearchFilters, type EmailSearchResult } from '@/local/search'
import { formatListDate } from '@/utils/format'

const props = defineProps<{
  folderId?: number
  name?: string  // Folder name from route param
}>()

const { data: folders, loaded: foldersLoaded } = useLiveQuery(() => db.folders.orderBy('position').toArray(), [])

// Search state
const showSearchToolbar = ref(false)
const searchActive = ref(false)
const searchFilters = ref<SearchFilters | null>(null)
const localResults = ref<EmailSearchResult[]>([])
const serverResults = ref<EmailSearchResult[]>([])
const searchingLocal = ref(false)
const searchingServer = ref(false)
const serverSearchFailed = ref(false)
const searchHasMore = ref(false)
const unreadOnly = ref(false)
// Bumped on every new search so that late responses to an old one are ignored
let searchRun = 0

const searchResults = computed(() => {
  const merged = mergeResults(localResults.value, serverResults.value)
  if (searchFilters.value?.sortBy === 'date') {
    return [...merged].sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0))
  }
  return merged
})

// Mark all as read state
const showMarkAllConfirm = ref(false)

async function handleMarkAllAsRead() {
  await enqueue({ type: 'folder.markAllRead', payload: { folderId: currentFolderId.value } })
  showMarkAllConfirm.value = false
}

// Determine current folder ID from props or route param
const currentFolderId = computed(() => {
  // If folderId is explicitly provided, use it
  if (props.folderId !== undefined) {
    return props.folderId
  }
  // If folder name is provided (from route), look it up
  if (props.name && folders.value.length > 0) {
    const folder = folders.value.find(
      f => f.name.toLowerCase() === props.name!.toLowerCase()
    )
    if (folder) return folder.id
  }
  // Default to Inbox (1)
  return 1
})

const currentFolder = computed(() => {
  return folders.value.find(f => f.id === currentFolderId.value)
})

const pageTitle = computed(() => {
  return currentFolder.value?.name ?? 'Inbox'
})

// Search functionality
function currentFilters(): EmailSearchFilters | null {
  if (!searchFilters.value) return null
  const { query, senderId, dateFrom, dateTo, sortBy, folderIds } = searchFilters.value
  return { query, senderId, dateFrom, dateTo, sortBy, folderIds, unreadOnly: unreadOnly.value }
}

async function onSearch(filters: SearchFilters) {
  searchFilters.value = filters
  searchActive.value = true
  await performSearch()
}

function onClearSearch() {
  searchRun++
  searchActive.value = false
  searchFilters.value = null
  localResults.value = []
  serverResults.value = []
  searchHasMore.value = false
  searchingLocal.value = false
  searchingServer.value = false
  // Keep toolbar visible - only hide via toggle button
}

// What's on this device answers straight away; the server then fills in the
// rest of the archive (and the threads it finds are kept locally)
async function performSearch() {
  const filters = currentFilters()
  if (!filters) return
  const run = ++searchRun

  serverResults.value = []
  searchHasMore.value = false
  serverSearchFailed.value = false
  searchingLocal.value = true
  searchingServer.value = true

  try {
    const results = await searchLocal(filters)
    if (run !== searchRun) return
    localResults.value = results
  } catch (e) {
    console.error('Local search failed:', e)
  } finally {
    if (run === searchRun) searchingLocal.value = false
  }

  await searchServerPage(filters, run)
}

async function searchServerPage(filters: EmailSearchFilters, run: number) {
  searchingServer.value = true
  try {
    const page = await searchServer(filters, serverResults.value.length)
    if (run !== searchRun) return
    serverResults.value.push(...page.results)
    searchHasMore.value = page.hasMore
  } catch (e) {
    if (run !== searchRun) return
    console.error('Server search failed:', e)
    serverSearchFailed.value = true
  } finally {
    if (run === searchRun) searchingServer.value = false
  }
}

function loadMoreResults() {
  const filters = currentFilters()
  if (filters) searchServerPage(filters, searchRun)
}

// Update title when folder changes
watch([pageTitle, foldersLoaded], () => {
  if (foldersLoaded.value) {
    document.title = `${pageTitle.value} - MereMail`
  }
}, { immediate: true })

// Clear search when switching folders
watch(() => props.name, () => {
  onClearSearch()
})

watch(unreadOnly, () => {
  if (searchActive.value) performSearch()
})
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>{{ pageTitle }}</h1>
      <FolderNav :active-folder-id="currentFolderId" />
    </header>

    <div class="search-toggle-bar">
      <button class="search-toggle-btn" @click="showSearchToolbar ? (showSearchToolbar = false, onClearSearch()) : showSearchToolbar = true">
        <span class="search-icon">🔍</span>
        <span>{{ showSearchToolbar ? 'Hide Search' : 'Search & Filter' }}</span>
      </button>
      <label class="unread-toggle">
        <input type="checkbox" v-model="unreadOnly" />
        <span class="check-icon">{{ unreadOnly ? '✓' : '' }}</span>
        <span>Unread only</span>
      </label>
      <div class="spacer"></div>
      <div v-if="showMarkAllConfirm" class="mark-all-confirm">
        <span>Mark all as read?</span>
        <button class="confirm-btn" @click="handleMarkAllAsRead">Yes</button>
        <button class="cancel-btn" @click="showMarkAllConfirm = false">No</button>
      </div>
      <button v-else class="mark-all-btn" @click="showMarkAllConfirm = true">
        Mark all read
      </button>
    </div>

    <SearchToolbar
      v-if="showSearchToolbar"
      :folder-id="currentFolderId"
      :folders="folders"
      :searching-server="searchActive && searchingServer"
      @search="onSearch"
      @clear="onClearSearch"
    />

    <main class="main">
      <!-- Search results -->
      <template v-if="searchActive">
        <div v-if="searchingLocal && searchResults.length === 0" class="loading">
          Searching...
        </div>

        <div v-else-if="searchResults.length === 0 && !searchingServer" class="empty">
          No emails found
        </div>

        <ul v-if="searchResults.length > 0" class="search-results">
          <li
            v-for="result in searchResults"
            :key="result.id"
            class="result-item"
            :class="{ unread: !result.isRead }"
          >
            <RouterLink :to="`/thread/${result.threadId}`" class="result-link">
              <div class="result-header">
                <span class="result-sender">{{ result.senderName || result.senderEmail }}</span>
                <span class="result-date">{{ formatListDate(result.sentAt) }}</span>
              </div>
              <div class="result-subject">{{ result.subject }}</div>
              <div class="result-snippet">{{ result.snippet }}</div>
            </RouterLink>
          </li>
        </ul>

        <div v-if="searchingServer" class="loading-more">
          Searching the rest of your mail...
        </div>

        <div v-else-if="serverSearchFailed" class="loading-more">
          Showing only what's on this device. The rest of your mail couldn't be searched right now.
        </div>

        <div v-else-if="searchHasMore" class="load-more">
          <button @click="loadMoreResults" class="load-more-btn">
            Load More
          </button>
        </div>
      </template>

      <!-- Regular thread list -->
      <ThreadList
        v-else-if="foldersLoaded"
        :key="`${currentFolderId}-${unreadOnly}`"
        :folder-id="currentFolderId"
        :unread-only="unreadOnly"
        empty-message="No threads yet"
      />
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

.search-toggle-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
  border-bottom: 1px solid #e5e5e5;
}

.search-toggle-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: #f5f5f5;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  color: #666;
  cursor: pointer;
  transition: all 0.15s;
}

.search-toggle-btn:hover {
  background: #e5e5e5;
  color: #333;
}

.search-toggle-btn .search-icon {
  font-size: 12px;
}

.unread-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: #f5f5f5;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  color: #666;
  cursor: pointer;
  transition: all 0.15s;
}

.unread-toggle:hover {
  background: #e5e5e5;
  color: #333;
}

.unread-toggle:has(input:checked) {
  background: #e0e7ff;
  color: #4338ca;
}

.unread-toggle input {
  display: none;
}

.unread-toggle .check-icon {
  width: 14px;
  height: 14px;
  border: 1.5px solid currentColor;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  line-height: 1;
}

.spacer {
  flex: 1;
}

.mark-all-btn {
  padding: 6px 12px;
  background: #f5f5f5;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  color: #666;
  cursor: pointer;
  transition: all 0.15s;
}

.mark-all-btn:hover {
  background: #e5e5e5;
  color: #333;
}

.mark-all-confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #666;
}

.mark-all-confirm .confirm-btn {
  padding: 4px 10px;
  background: #3b82f6;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  color: #fff;
  cursor: pointer;
  transition: all 0.15s;
}

.mark-all-confirm .confirm-btn:hover:not(:disabled) {
  background: #2563eb;
}

.mark-all-confirm .confirm-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.mark-all-confirm .cancel-btn {
  padding: 4px 10px;
  background: #f5f5f5;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  color: #666;
  cursor: pointer;
  transition: all 0.15s;
}

.mark-all-confirm .cancel-btn:hover:not(:disabled) {
  background: #e5e5e5;
  color: #333;
}

.mark-all-confirm .cancel-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.loading,
.empty {
  padding: 40px 20px;
  text-align: center;
  color: #666;
}

.loading-more {
  padding: 20px;
  text-align: center;
  color: #666;
  font-size: 14px;
}

.search-results {
  list-style: none;
  margin: 0;
  padding: 0;
}

.result-item {
  border-bottom: 1px solid #f0f0f0;
}

.result-item.unread .result-sender,
.result-item.unread .result-subject {
  font-weight: 700;
}

.result-item:not(.unread) .result-sender,
.result-item:not(.unread) .result-subject,
.result-item:not(.unread) .result-snippet {
  color: #888;
}

.result-link {
  display: block;
  padding: 16px 20px;
  text-decoration: none;
  color: inherit;
  transition: background-color 0.1s ease;
}

.result-link:hover {
  background-color: #fafafa;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 4px;
}

.result-sender {
  font-weight: 600;
  font-size: 14px;
  color: #1a1a1a;
}

.result-date {
  font-size: 12px;
  color: #888;
  flex-shrink: 0;
  margin-left: 12px;
}

.result-subject {
  font-size: 14px;
  color: #333;
  margin-bottom: 4px;
  font-weight: 500;
}

.result-snippet {
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

.load-more-btn:hover {
  background: #fafafa;
  border-color: #ccc;
}
</style>
