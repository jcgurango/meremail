<script setup lang="ts">
import { computed, onMounted, watch, ref } from 'vue'
import { RouterLink } from 'vue-router'
import ThreadList from '@/components/ThreadList.vue'
import FolderNav from '@/components/FolderNav.vue'
import SearchToolbar, { type SearchFilters } from '@/components/SearchToolbar.vue'
import { getFolders } from '@/utils/api'

const props = defineProps<{
  folderId?: number
  name?: string  // Folder name from route param
}>()

// Dynamic folder data for title
interface Folder {
  id: number
  name: string
}

interface SearchResult {
  type: 'email'
  id: number
  threadId: number
  subject: string
  snippet: string
  senderName: string | null
  senderEmail: string
  sentAt: string | null
  isRead: boolean
}

const folders = ref<Folder[]>([])
const foldersLoaded = ref(false)

// Search state
const showSearchToolbar = ref(false)
const searchActive = ref(false)
const searchFilters = ref<SearchFilters | null>(null)
const searchResults = ref<SearchResult[]>([])
const searchLoading = ref(false)
const searchHasMore = ref(false)
const searchOffset = ref(0)
const SEARCH_LIMIT = 25

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

async function loadFolders() {
  try {
    const result = await getFolders()
    folders.value = result.data.folders
    foldersLoaded.value = true
  } catch (e) {
    console.error('Failed to load folders:', e)
  }
}

// Search functionality
async function onSearch(filters: SearchFilters) {
  searchFilters.value = filters
  searchActive.value = true
  searchOffset.value = 0
  searchResults.value = []
  await performSearch(true)
}

function onClearSearch() {
  searchActive.value = false
  searchFilters.value = null
  searchResults.value = []
  searchOffset.value = 0
  searchHasMore.value = false
  // Keep toolbar visible - only hide via toggle button
}

async function performSearch(reset = true) {
  if (!searchFilters.value) return

  if (reset) {
    searchOffset.value = 0
    searchResults.value = []
  }

  searchLoading.value = true
  try {
    const params = new URLSearchParams({
      type: 'email',
      limit: String(SEARCH_LIMIT),
      offset: String(searchOffset.value),
      folderId: String(currentFolderId.value),
    })

    if (searchFilters.value.query) params.set('q', searchFilters.value.query)
    if (searchFilters.value.senderId) params.set('senderId', String(searchFilters.value.senderId))
    if (searchFilters.value.dateFrom) params.set('dateFrom', searchFilters.value.dateFrom)
    if (searchFilters.value.dateTo) params.set('dateTo', searchFilters.value.dateTo)
    if (searchFilters.value.unreadOnly) params.set('unreadOnly', 'true')
    if (searchFilters.value.sortBy) params.set('sortBy', searchFilters.value.sortBy)

    const response = await fetch(`/api/search?${params}`)
    if (response.ok) {
      const data = await response.json() as { results: SearchResult[]; hasMore: boolean }
      if (reset) {
        searchResults.value = data.results
      } else {
        searchResults.value.push(...data.results)
      }
      searchHasMore.value = data.hasMore
      searchOffset.value += data.results.length
    }
  } catch (e) {
    console.error('Search failed:', e)
  } finally {
    searchLoading.value = false
  }
}

function loadMoreResults() {
  performSearch(false)
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

onMounted(() => {
  loadFolders()
})

// Update title when folder changes
watch([pageTitle, foldersLoaded], () => {
  if (foldersLoaded.value) {
    document.title = `${pageTitle.value} - MereMail`
  }
})

// Reload folders when switching (to get updated counts)
// Also clear search when switching folders
watch(() => props.name, () => {
  loadFolders()
  onClearSearch()
})
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>{{ pageTitle }}</h1>
      <FolderNav :active-folder-id="currentFolderId" />
    </header>

    <div class="search-toggle-bar">
      <button class="search-toggle-btn" @click="showSearchToolbar = !showSearchToolbar">
        <span class="search-icon">🔍</span>
        <span>{{ showSearchToolbar ? 'Hide Search' : 'Search & Filter' }}</span>
      </button>
    </div>

    <SearchToolbar
      v-if="showSearchToolbar"
      :folder-id="currentFolderId"
      @search="onSearch"
      @clear="onClearSearch"
    />

    <main class="main">
      <!-- Search results -->
      <template v-if="searchActive">
        <div v-if="searchLoading && searchResults.length === 0" class="loading">
          Searching...
        </div>

        <div v-else-if="searchResults.length === 0 && !searchLoading" class="empty">
          No emails found
        </div>

        <ul v-else class="search-results">
          <li
            v-for="result in searchResults"
            :key="result.id"
            class="result-item"
            :class="{ unread: !result.isRead }"
          >
            <RouterLink :to="`/thread/${result.threadId}`" class="result-link">
              <div class="result-header">
                <span class="result-sender">{{ result.senderName || result.senderEmail }}</span>
                <span class="result-date">{{ formatDate(result.sentAt) }}</span>
              </div>
              <div class="result-subject">{{ result.subject }}</div>
              <div class="result-snippet">{{ result.snippet }}</div>
            </RouterLink>
          </li>
        </ul>

        <div v-if="searchHasMore && !searchLoading" class="load-more">
          <button @click="loadMoreResults" class="load-more-btn">
            Load More
          </button>
        </div>

        <div v-if="searchLoading && searchResults.length > 0" class="loading-more">
          Loading...
        </div>
      </template>

      <!-- Regular thread list -->
      <ThreadList
        v-else-if="foldersLoaded"
        :key="currentFolderId"
        :folder-id="currentFolderId"
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
