<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { parseQuery, hasCriteria, setOperator } from '@meremail/shared/search'

interface Folder {
  id: number
  name: string
}

const props = defineProps<{
  folderId?: number
  folders: Folder[]
  /** True while the server is being searched (results from this device show first) */
  searchingServer?: boolean
  /** Query to start with, when a search is being restored (e.g. coming back to the page) */
  initial?: string | null
}>()

const emit = defineEmits<{
  /** The query, in the search query language (see @meremail/shared/search) */
  (e: 'search', query: string): void
  (e: 'clear'): void
}>()

// A new search starts in the folder being looked at
function defaultQuery(): string {
  const folder = props.folders.find(f => f.id === props.folderId)
  return folder ? setOperator('', 'in', [folder.name.toLowerCase()]) : ''
}

// The query text is the whole search: folders, people, dates and order are
// all operators typed into it
const searchQuery = ref(props.initial ?? defaultQuery())
const searchInput = ref<HTMLInputElement | null>(null)
const showHelp = ref(false)

// Ready to type, after whatever the box starts with
onMounted(() => {
  if (props.initial) return
  searchInput.value?.focus()
  searchInput.value?.setSelectionRange(searchQuery.value.length, searchQuery.value.length)
})

const hasActiveFilters = computed(() => hasCriteria(parseQuery(searchQuery.value)))

function emitSearch() {
  if (!hasActiveFilters.value) {
    emit('clear')
    return
  }

  emit('search', searchQuery.value)
}

// Debounce search input
let searchDebounce: ReturnType<typeof setTimeout> | null = null
function onSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    emitSearch()
  }, 300)
}

function clearSearch() {
  searchQuery.value = defaultQuery()
  emit('clear')
  searchInput.value?.focus()
}
</script>

<template>
  <div class="search-toolbar">
    <div class="toolbar-row">
      <!-- Search input -->
      <div class="search-input-wrapper">
        <span class="search-icon">🔍</span>
        <input
          ref="searchInput"
          v-model="searchQuery"
          type="text"
          placeholder="Search mail, e.g. invoice from:alice"
          class="search-input"
          @input="onSearchInput"
        />
        <span v-if="searchingServer" class="server-search-indicator" title="Results from this device are shown first">
          <span class="server-search-spinner"></span>
          Searching server…
        </span>
        <button
          type="button"
          class="help-btn"
          :class="{ active: showHelp }"
          title="Search tips"
          @click="showHelp = !showHelp"
        >?</button>
      </div>

      <button
        v-if="hasActiveFilters"
        class="clear-all-btn"
        @click="clearSearch"
      >
        Clear
      </button>
    </div>

    <div v-if="showHelp" class="search-help">
      <span><code>invoice march</code> every word, anywhere in the message</span>
      <span><code>"exact phrase"</code></span>
      <span><code>from:alice</code> <code>to:bob@example.com</code> name or address</span>
      <span><code>subject:word</code> <code>filename:report.pdf</code></span>
      <span><code>in:inbox</code> one folder; leave out for all folders</span>
      <span><code>has:attachment</code> <code>is:unread</code> <code>is:read</code></span>
      <span><code>after:2026-01-31</code> <code>before:2026-02-28</code> including those days</span>
      <span><code>sort:oldest</code> oldest first, instead of newest</span>
    </div>
  </div>
</template>

<style scoped>
.search-toolbar {
  padding: 12px 20px;
  background: #fafafa;
  border-bottom: 1px solid #e5e5e5;
}

.toolbar-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.server-search-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #6b7280;
  white-space: nowrap;
}

.server-search-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid #d1d5db;
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: server-search-spin 0.8s linear infinite;
}

@keyframes server-search-spin {
  to {
    transform: rotate(360deg);
  }
}

.search-input-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
}

.search-icon {
  font-size: 14px;
  opacity: 0.6;
}

.search-input {
  flex: 1;
  border: none;
  background: none;
  outline: none;
  font-size: 14px;
}

.help-btn {
  width: 20px;
  height: 20px;
  padding: 0;
  background: none;
  border: 1px solid #ddd;
  border-radius: 50%;
  font-size: 12px;
  color: #666;
  cursor: pointer;
  flex-shrink: 0;
}

.help-btn:hover,
.help-btn.active {
  border-color: #999;
  color: #333;
}

.search-help {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin-top: 10px;
  font-size: 12px;
  color: #666;
}

.search-help code {
  padding: 1px 4px;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 3px;
  font-size: 12px;
  color: #333;
}

.clear-all-btn {
  padding: 6px 12px;
  background: none;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
  color: #666;
  cursor: pointer;
}

.clear-all-btn:hover {
  border-color: #999;
  color: #333;
}
</style>
