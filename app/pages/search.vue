<script setup lang="ts">
interface EmailResult {
  type: 'email'
  id: number
  threadId: number
  subject: string
  snippet: string
  senderName: string | null
  senderEmail: string
  sentAt: string | null
}

interface ContactResult {
  type: 'contact'
  id: number
  name: string | null
  email: string
  bucket: string | null
  isMe: boolean
}

interface AttachmentResult {
  type: 'attachment'
  id: number
  emailId: number
  threadId: number
  filename: string
  mimeType: string | null
  size: number | null
  sentAt: string | null
  senderName: string | null
  senderEmail: string
}

interface Contact {
  id: number
  name: string | null
  email: string
}

type SearchResult = EmailResult | ContactResult | AttachmentResult

const route = useRoute()
const router = useRouter()

// Get initial values from query params
const searchQuery = ref((route.query.q as string) || '')
const selectedType = ref<string>((route.query.type as string) || 'email')
const dateFrom = ref<string>((route.query.dateFrom as string) || '')
const dateTo = ref<string>((route.query.dateTo as string) || '')
const senderId = ref<number | null>(route.query.senderId ? parseInt(route.query.senderId as string) : null)
const fileType = ref<string>((route.query.fileType as string) || '')

const results = ref<SearchResult[]>([])
const loading = ref(false)
const hasMore = ref(false)
const offset = ref(0)
const LIMIT = 25

// Sender search
const senderSearch = ref('')
const senderResults = ref<Contact[]>([])
const senderSearchLoading = ref(false)
const selectedSender = ref<Contact | null>(null)
const showSenderDropdown = ref(false)
let senderDebounce: ReturnType<typeof setTimeout> | null = null

const pageTitle = computed(() => {
  if (searchQuery.value) {
    return `Search: ${searchQuery.value} - MereMail`
  }
  if (selectedType.value === 'attachment') {
    return 'Attachments - MereMail'
  }
  return 'Search - MereMail'
})
useHead({ title: pageTitle })

// Type options
const typeOptions = [
  { value: 'email', label: 'Emails', icon: '✉️' },
  { value: 'contact', label: 'Contacts', icon: '👤' },
  { value: 'attachment', label: 'Attachments', icon: '📎' },
]

// File type options
const fileTypeOptions = [
  { value: '', label: 'All Files' },
  { value: 'image', label: 'Images' },
  { value: 'document', label: 'Documents' },
  { value: 'spreadsheet', label: 'Spreadsheets' },
  { value: 'presentation', label: 'Presentations' },
  { value: 'archive', label: 'Archives' },
  { value: 'audio', label: 'Audio' },
  { value: 'video', label: 'Video' },
]

// Update URL when filters change
function updateUrl() {
  const query: Record<string, string> = {}
  if (searchQuery.value) query.q = searchQuery.value
  if (selectedType.value) query.type = selectedType.value
  if (dateFrom.value) query.dateFrom = dateFrom.value
  if (dateTo.value) query.dateTo = dateTo.value
  if (senderId.value) query.senderId = String(senderId.value)
  if (fileType.value) query.fileType = fileType.value
  router.replace({ query })
}

async function search(reset = true) {
  // Attachments can always be browsed without a search term
  // Emails can be browsed if filters are set (sender or date range)
  const hasFilters = senderId.value || dateFrom.value || dateTo.value
  const canBrowseWithoutSearch = selectedType.value === 'attachment' ||
    (selectedType.value === 'email' && hasFilters)

  if (!canBrowseWithoutSearch && searchQuery.value.length < 2) {
    results.value = []
    hasMore.value = false
    return
  }

  if (reset) {
    offset.value = 0
    results.value = []
  }

  loading.value = true
  try {
    const params: Record<string, string> = {
      q: searchQuery.value,
      type: selectedType.value,
      limit: String(LIMIT),
      offset: String(offset.value),
    }
    if (dateFrom.value) params.dateFrom = dateFrom.value
    if (dateTo.value) params.dateTo = dateTo.value
    if (senderId.value) params.senderId = String(senderId.value)
    if (fileType.value) params.fileType = fileType.value

    const data = await $fetch<{ results: SearchResult[], hasMore: boolean }>('/api/search', {
      query: params
    })

    if (reset) {
      results.value = data.results
    } else {
      results.value.push(...data.results)
    }
    hasMore.value = data.hasMore
    offset.value += data.results.length
  } catch (e) {
    console.error('Search failed:', e)
  } finally {
    loading.value = false
  }
}

function loadMore() {
  search(false)
}

// Debounce search input
let debounceTimer: ReturnType<typeof setTimeout> | null = null
function onSearchInput() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    updateUrl()
    search(true)
  }, 300)
}

// Sender search with debounce
async function onSenderSearchInput() {
  if (senderDebounce) clearTimeout(senderDebounce)

  if (senderSearch.value.length < 2) {
    senderResults.value = []
    return
  }

  senderDebounce = setTimeout(async () => {
    senderSearchLoading.value = true
    try {
      const data = await $fetch<{ results: ContactResult[] }>('/api/search', {
        query: { q: senderSearch.value, type: 'contact', limit: '10' }
      })
      senderResults.value = data.results.map(r => ({ id: r.id, name: r.name, email: r.email }))
    } catch (e) {
      senderResults.value = []
    } finally {
      senderSearchLoading.value = false
    }
  }, 300)
}

function selectSender(contact: Contact) {
  selectedSender.value = contact
  senderId.value = contact.id
  senderSearch.value = ''
  senderResults.value = []
  showSenderDropdown.value = false
  updateUrl()
  search(true)
}

function clearSender() {
  selectedSender.value = null
  senderId.value = null
  updateUrl()
  search(true)
}

// Watch filter changes (not sender since it has its own handler)
watch([selectedType, dateFrom, dateTo, fileType], () => {
  // Clear sender when switching types (except between email/attachment which both support it)
  if (selectedType.value === 'contact') {
    senderId.value = null
    selectedSender.value = null
  }
  // Clear file type when not on attachments
  if (selectedType.value !== 'attachment') {
    fileType.value = ''
  }
  updateUrl()
  search(true)
})

// Initial search if query present or browsing attachments
if (searchQuery.value || selectedType.value === 'attachment') {
  search(true)
}

// Load sender info if senderId is set from URL
if (senderId.value) {
  $fetch<{ id: number; name: string | null; email: string }>(`/api/contacts/${senderId.value}`)
    .then(contact => {
      selectedSender.value = { id: contact.id, name: contact.name, email: contact.email }
    })
    .catch(() => {
      senderId.value = null
    })
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function clearDateFilters() {
  dateFrom.value = ''
  dateTo.value = ''
}
</script>

<template>
  <div class="search-page">
    <header class="page-header">
      <NuxtLink to="/" class="back-link">&larr; Threads</NuxtLink>
      <h1>{{ selectedType === 'attachment' && !searchQuery ? 'Attachments' : 'Search' }}</h1>
    </header>

    <div class="search-controls">
      <div class="search-input-wrapper">
        <span class="search-icon">🔍</span>
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="selectedType === 'attachment' ? 'Search attachments...' : 'Search...'"
          class="search-input"
          @input="onSearchInput"
        />
      </div>

      <div class="filters">
        <div class="type-tabs">
          <button
            v-for="opt in typeOptions"
            :key="opt.value"
            class="type-tab"
            :class="{ active: selectedType === opt.value }"
            @click="selectedType = opt.value"
          >
            <span class="tab-icon">{{ opt.icon }}</span>
            <span class="tab-label">{{ opt.label }}</span>
          </button>
        </div>

        <!-- Sender filter (for emails and attachments) -->
        <div v-if="selectedType === 'email' || selectedType === 'attachment'" class="sender-filter">
          <label>From</label>
          <div class="sender-input-wrapper">
            <div v-if="selectedSender" class="selected-sender">
              <span>{{ selectedSender.name || selectedSender.email }}</span>
              <button class="clear-sender" @click="clearSender">✕</button>
            </div>
            <div v-else class="sender-search-wrapper">
              <input
                v-model="senderSearch"
                type="text"
                placeholder="Search contacts..."
                class="sender-search"
                @input="onSenderSearchInput"
                @focus="showSenderDropdown = true"
              />
              <div v-if="showSenderDropdown && (senderResults.length > 0 || senderSearchLoading)" class="sender-dropdown">
                <div v-if="senderSearchLoading" class="sender-loading">Searching...</div>
                <button
                  v-for="contact in senderResults"
                  :key="contact.id"
                  class="sender-option"
                  @click="selectSender(contact)"
                >
                  <span class="sender-name">{{ contact.name || contact.email }}</span>
                  <span v-if="contact.name" class="sender-email">{{ contact.email }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- File type filter (attachments only) -->
        <div v-if="selectedType === 'attachment'" class="file-type-filter">
          <label>Type</label>
          <select v-model="fileType">
            <option v-for="opt in fileTypeOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <!-- Date filters -->
        <div v-if="selectedType !== 'contact'" class="date-filters">
          <div class="date-field">
            <label>From</label>
            <input type="date" v-model="dateFrom" />
          </div>
          <div class="date-field">
            <label>To</label>
            <input type="date" v-model="dateTo" />
          </div>
          <button
            v-if="dateFrom || dateTo"
            class="clear-dates"
            @click="clearDateFilters"
          >
            Clear
          </button>
        </div>
      </div>
    </div>

    <div class="results-section">
      <div v-if="loading && results.length === 0" class="loading">
        {{ selectedType === 'attachment' && !searchQuery ? 'Loading...' : 'Searching...' }}
      </div>

      <div v-else-if="(searchQuery.length >= 2 || selectedType === 'attachment') && results.length === 0 && !loading" class="no-results">
        No {{ selectedType === 'attachment' ? 'attachments' : 'results' }} found
      </div>

      <div v-else-if="results.length > 0" class="results-list">
        <!-- Email results -->
        <template v-if="selectedType === 'email'">
          <NuxtLink
            v-for="result in results"
            :key="`email-${(result as EmailResult).id}`"
            :to="`/thread/${(result as EmailResult).threadId}`"
            class="result-item email-item"
          >
            <div class="result-icon">✉️</div>
            <div class="result-content">
              <div class="result-title">{{ (result as EmailResult).subject }}</div>
              <div class="result-meta">
                <span>{{ (result as EmailResult).senderName || (result as EmailResult).senderEmail }}</span>
                <span v-if="(result as EmailResult).sentAt" class="result-date">
                  {{ formatDate((result as EmailResult).sentAt) }}
                </span>
              </div>
              <div class="result-snippet">{{ (result as EmailResult).snippet }}</div>
            </div>
          </NuxtLink>
        </template>

        <!-- Contact results -->
        <template v-if="selectedType === 'contact'">
          <NuxtLink
            v-for="result in results"
            :key="`contact-${(result as ContactResult).id}`"
            :to="`/contact/${(result as ContactResult).id}`"
            class="result-item contact-item"
          >
            <div class="result-icon">👤</div>
            <div class="result-content">
              <div class="result-title">{{ (result as ContactResult).name || (result as ContactResult).email }}</div>
              <div v-if="(result as ContactResult).name" class="result-meta">
                {{ (result as ContactResult).email }}
              </div>
              <div v-if="(result as ContactResult).bucket" class="result-badge" :class="(result as ContactResult).bucket">
                {{ (result as ContactResult).bucket?.replace('_', ' ') }}
              </div>
            </div>
          </NuxtLink>
        </template>

        <!-- Attachment results -->
        <template v-if="selectedType === 'attachment'">
          <NuxtLink
            v-for="result in results"
            :key="`attachment-${(result as AttachmentResult).id}`"
            :to="`/attachment/${(result as AttachmentResult).id}`"
            class="result-item attachment-item"
          >
            <div class="result-icon">📎</div>
            <div class="result-content">
              <div class="result-title">{{ (result as AttachmentResult).filename }}</div>
              <div class="result-meta">
                <span v-if="(result as AttachmentResult).size">
                  {{ formatFileSize((result as AttachmentResult).size) }}
                </span>
                <span>{{ (result as AttachmentResult).senderName || (result as AttachmentResult).senderEmail }}</span>
                <span v-if="(result as AttachmentResult).sentAt" class="result-date">
                  {{ formatDate((result as AttachmentResult).sentAt) }}
                </span>
              </div>
            </div>
          </NuxtLink>
        </template>
      </div>

      <div v-if="hasMore" class="load-more">
        <button @click="loadMore" :disabled="loading">
          {{ loading ? 'Loading...' : 'Load More' }}
        </button>
      </div>

      <div v-if="selectedType === 'contact' && searchQuery.length < 2 && results.length === 0" class="search-hint">
        Type at least 2 characters to search
      </div>
      <div v-else-if="selectedType === 'email' && searchQuery.length < 2 && !senderId && !dateFrom && !dateTo && results.length === 0" class="search-hint">
        Type at least 2 characters or select a filter
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-page {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.page-header {
  margin-bottom: 24px;
}

.back-link {
  display: inline-block;
  color: #666;
  text-decoration: none;
  font-size: 14px;
  margin-bottom: 8px;
}

.back-link:hover {
  color: #000;
}

h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
}

.search-controls {
  margin-bottom: 24px;
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #f5f5f5;
  border-radius: 8px;
  margin-bottom: 16px;
}

.search-icon {
  font-size: 18px;
}

.search-input {
  flex: 1;
  border: none;
  background: none;
  outline: none;
  font-size: 16px;
}

.filters {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.type-tabs {
  display: flex;
  gap: 8px;
}

.type-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 20px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
}

.type-tab:hover {
  border-color: #999;
}

.type-tab.active {
  background: #000;
  border-color: #000;
  color: #fff;
}

.tab-icon {
  font-size: 14px;
}

.sender-filter,
.file-type-filter {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sender-filter > label,
.file-type-filter > label {
  font-size: 13px;
  color: #666;
  min-width: 40px;
}

.sender-input-wrapper {
  flex: 1;
  max-width: 300px;
}

.sender-search-wrapper {
  position: relative;
}

.sender-search {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
}

.sender-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 100;
  max-height: 200px;
  overflow-y: auto;
}

.sender-loading {
  padding: 12px;
  color: #666;
  font-size: 13px;
}

.sender-option {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 10px 12px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
}

.sender-option:hover {
  background: #f5f5f5;
}

.sender-name {
  font-size: 13px;
  color: #000;
}

.sender-email {
  font-size: 12px;
  color: #666;
}

.selected-sender {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: #f0f0f0;
  border-radius: 4px;
  font-size: 13px;
}

.clear-sender {
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  padding: 0 4px;
  font-size: 14px;
}

.clear-sender:hover {
  color: #000;
}

.file-type-filter select {
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
  background: #fff;
  min-width: 150px;
}

.date-filters {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.date-field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.date-field label {
  font-size: 13px;
  color: #666;
}

.date-field input {
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
}

.clear-dates {
  padding: 6px 12px;
  background: none;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
  color: #666;
  cursor: pointer;
}

.clear-dates:hover {
  border-color: #999;
  color: #000;
}

.loading,
.no-results,
.search-hint {
  text-align: center;
  padding: 40px 20px;
  color: #666;
}

.results-list {
  display: flex;
  flex-direction: column;
}

.result-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid #eee;
  text-decoration: none;
  color: inherit;
  transition: background 0.15s;
}

.result-item:hover {
  background: #fafafa;
}

.result-icon {
  font-size: 20px;
  line-height: 1;
  flex-shrink: 0;
  padding-top: 2px;
}

.result-content {
  flex: 1;
  min-width: 0;
}

.result-title {
  font-size: 15px;
  font-weight: 500;
  color: #000;
  margin-bottom: 4px;
}

.result-meta {
  font-size: 13px;
  color: #666;
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.result-date {
  color: #999;
}

.result-snippet {
  font-size: 13px;
  color: #888;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 500;
  text-transform: capitalize;
  padding: 2px 8px;
  border-radius: 10px;
  margin-top: 4px;
}

.result-badge.approved {
  background: #dcfce7;
  color: #166534;
}

.result-badge.feed {
  background: #dbeafe;
  color: #1e40af;
}

.result-badge.paper_trail {
  background: #f3e8ff;
  color: #7c3aed;
}

.result-badge.blocked {
  background: #fee2e2;
  color: #991b1b;
}

.load-more {
  text-align: center;
  padding: 24px;
}

.load-more button {
  padding: 12px 32px;
  background: #000;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.load-more button:hover:not(:disabled) {
  opacity: 0.85;
}

.load-more button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
