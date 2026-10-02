<script setup lang="ts">
import { computed, watch, ref } from 'vue'
import { RouterLink, useRoute, useRouter, type LocationQuery, type LocationQueryRaw } from 'vue-router'
import ThreadList from '@/components/ThreadList.vue'
import FolderNav from '@/components/FolderNav.vue'
import SearchToolbar from '@/components/SearchToolbar.vue'
import { db } from '@/local/db'
import { useLiveQuery } from '@/local/live'
import { enqueue } from '@/local/actions'
import { parseQuery, hasCriteria, highlight } from '@meremail/shared/search'
import { searchLocal, searchServer, mergeResults, resultKey, lastSearch, refreshReadState, type EmailSearchFilters, type EmailSearchResult } from '@/local/search'
import { formatListDate } from '@/utils/format'

const props = defineProps<{
  folderId?: number
  name?: string  // Folder name from route param
}>()

const { data: folders, loaded: foldersLoaded } = useLiveQuery(() => db.folders.orderBy('position').toArray(), [])

const route = useRoute()
const router = useRouter()

// The search lives in the URL (?q=...), so it survives opening a
// result and coming back, reloading, and can be linked to.
function queryString(value: LocationQuery[string] | undefined): string {
  return typeof value === 'string' ? value : ''
}

function searchFromQuery(query: LocationQuery): string | null {
  const text = queryString(query.q)
  // A choice of folders alone is not a search
  return hasCriteria(parseQuery(text)) ? text : null
}

function searchToQuery(search: string | null): LocationQueryRaw {
  const query: LocationQueryRaw = {}
  if (search !== null) query.q = search
  if (unreadOnly.value) query.unread = '1'
  return query
}

// Search state
const searchText = ref<string | null>(searchFromQuery(route.query))
const searchActive = computed(() => searchText.value !== null)
const showSearchToolbar = ref(searchActive.value)
// Bumped when the search changes from outside the toolbar (back/forward), so the toolbar picks it up
const toolbarKey = ref(0)
let lastToolbarSearch = searchText.value
const localResults = ref<EmailSearchResult[]>([])
const serverResults = ref<EmailSearchResult[]>([])
const searchingLocal = ref(false)
const searchingServer = ref(false)
const serverSearchFailed = ref(false)
const searchHasMore = ref(false)
const unreadOnly = computed({
  get: () => route.query.unread === '1',
  set: (value: boolean) => {
    const query = { ...route.query }
    if (value) query.unread = '1'
    else delete query.unread
    router.replace({ query })
  },
})
// Bumped on every new search so that late responses to an old one are ignored
let searchRun = 0

const parsedQuery = computed(() => parseQuery(searchText.value ?? ''))

const searchResults = computed(() =>
  mergeResults(localResults.value, serverResults.value, parsedQuery.value.sort).map(result => ({
    ...result,
    key: resultKey(result),
    link: result.threadId !== null ? `/thread/${result.threadId}` : `/draft/${result.draftId}`,
    subjectParts: highlight(result.subject, parsedQuery.value, 'subject'),
    snippetParts: highlight(result.snippet, parsedQuery.value, 'body'),
  }))
)

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
  if (searchText.value === null) return null
  return { query: searchText.value, unreadOnly: unreadOnly.value }
}

function onSearch(search: string) {
  lastToolbarSearch = search
  router.replace({ query: searchToQuery(search) })
}

function onClearSearch() {
  lastToolbarSearch = null
  if (searchActive.value) {
    router.replace({ query: searchToQuery(null) })
  }
  // Keep toolbar visible - only hide via toggle button
}

function resetSearchState() {
  searchRun++
  localResults.value = []
  serverResults.value = []
  searchHasMore.value = false
  searchingLocal.value = false
  searchingServer.value = false
}

// What's on this device answers straight away; the server then fills in the
// rest of the archive (and the threads it finds are kept locally)
async function performSearch() {
  const filters = currentFilters()
  if (!filters) return
  const run = ++searchRun
  const key = JSON.stringify(filters)

  // Returning to the search we just ran (e.g. Back from a result): show the same list again
  if (lastSearch.key === key) {
    searchingLocal.value = false
    searchingServer.value = false
    serverSearchFailed.value = false
    searchHasMore.value = lastSearch.hasMore
    localResults.value = lastSearch.local
    serverResults.value = lastSearch.server
    const [local, server] = await Promise.all([refreshReadState(lastSearch.local), refreshReadState(lastSearch.server)])
    if (run !== searchRun) return
    localResults.value = lastSearch.local = local
    serverResults.value = lastSearch.server = server
    return
  }

  lastSearch.key = ''
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

    // Remember the finished search (only once the server has answered, so a
    // device-only result set from an offline attempt isn't mistaken for complete)
    lastSearch.key = JSON.stringify(filters)
    lastSearch.local = localResults.value
    lastSearch.server = serverResults.value
    lastSearch.hasMore = page.hasMore
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

// The URL is the source of truth: run whatever search it describes
watch(() => route.query, (query) => {
  const search = searchFromQuery(query)
  searchText.value = search

  // Changed by navigation rather than by typing in the toolbar: re-seed the toolbar
  if (search !== lastToolbarSearch) {
    lastToolbarSearch = search
    toolbarKey.value++
    if (search !== null) showSearchToolbar.value = true
  }

  if (search !== null) {
    performSearch()
  } else {
    resetSearchState()
  }
}, { immediate: true })
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
        <span>{{ showSearchToolbar ? 'Hide Search' : 'Search' }}</span>
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
      :key="`${currentFolderId}-${toolbarKey}`"
      :initial="searchText"
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
            :key="result.key"
            class="result-item"
            :class="{ unread: !result.isRead }"
          >
            <RouterLink :to="result.link" class="result-link">
              <div class="result-header">
                <span class="result-sender">
                  <span v-if="result.draftId" class="draft-badge">Draft</span>
                  {{ result.senderName || result.senderEmail }}
                </span>
                <span class="result-date">{{ formatListDate(result.date) }}</span>
              </div>
              <div class="result-subject">
                <template v-for="(part, i) in result.subjectParts" :key="i"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template>
                <span v-if="result.matches > 1" class="result-matches">{{ result.matches }} matching messages</span>
              </div>
              <div class="result-snippet">
                <template v-for="(part, i) in result.snippetParts" :key="i"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template>
              </div>
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

.result-item mark {
  background: #fef08a;
  color: inherit;
  border-radius: 2px;
}

.result-matches {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 400;
  color: #888;
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
