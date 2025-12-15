<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useOffline } from '@/composables/useOffline'
import MustBeOnline from '@/components/MustBeOnline.vue'

const { isOnline } = useOffline()

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

interface Contact {
  id: number
  name: string | null
  email: string
}

const route = useRoute()
const router = useRouter()

// Get initial values from query params
const searchQuery = ref((route.query.q as string) || '')
const dateFrom = ref<string>((route.query.dateFrom as string) || '')
const dateTo = ref<string>((route.query.dateTo as string) || '')
const senderId = ref<number | null>(route.query.senderId ? parseInt(route.query.senderId as string) : null)

const results = ref<EmailResult[]>([])
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
  return 'Search Emails - MereMail'
})

onMounted(() => {
  document.title = pageTitle.value

  // Initial search if query present or filters set
  if (searchQuery.value || senderId.value || dateFrom.value || dateTo.value) {
    search(true)
  }

  // Load sender info if senderId is set from URL
  if (senderId.value) {
    fetch(`/api/contacts/${senderId.value}`)
      .then(res => res.json())
      .then((data: { contact: { id: number; name: string | null; email: string } }) => {
        selectedSender.value = { id: data.contact.id, name: data.contact.name, email: data.contact.email }
      })
      .catch(() => {
        senderId.value = null
      })
  }
})

watch(pageTitle, (newTitle) => {
  document.title = newTitle
})

// Update URL when filters change
function updateUrl() {
  const query: Record<string, string> = {}
  if (searchQuery.value) query.q = searchQuery.value
  if (dateFrom.value) query.dateFrom = dateFrom.value
  if (dateTo.value) query.dateTo = dateTo.value
  if (senderId.value) query.senderId = String(senderId.value)
  router.replace({ query })
}

async function search(reset = true) {
  // Emails can be browsed if filters are set (sender or date range)
  const hasFilters = senderId.value || dateFrom.value || dateTo.value

  if (!hasFilters && searchQuery.value.length < 2) {
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
    const params = new URLSearchParams({
      q: searchQuery.value,
      type: 'email',
      limit: String(LIMIT),
      offset: String(offset.value),
    })
    if (dateFrom.value) params.set('dateFrom', dateFrom.value)
    if (dateTo.value) params.set('dateTo', dateTo.value)
    if (senderId.value) params.set('senderId', String(senderId.value))

    const response = await fetch(`/api/search?${params}`)
    if (response.ok) {
      const data = await response.json() as { results: EmailResult[], hasMore: boolean }

      if (reset) {
        results.value = data.results
      } else {
        results.value.push(...data.results)
      }
      hasMore.value = data.hasMore
      offset.value += data.results.length
    }
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
      const response = await fetch(`/api/contacts?q=${encodeURIComponent(senderSearch.value)}&limit=10&view=all`)
      if (response.ok) {
        const data = await response.json() as { contacts: Contact[] }
        senderResults.value = data.contacts.map(r => ({ id: r.id, name: r.name, email: r.email }))
      }
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

// Watch filter changes
watch([dateFrom, dateTo], () => {
  updateUrl()
  search(true)
})

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function clearDateFilters() {
  dateFrom.value = ''
  dateTo.value = ''
}
</script>

<template>
  <div class="search-page">
    <header class="page-header">
      <RouterLink to="/" class="back-link">&larr; Inbox</RouterLink>
      <h1>Search Emails</h1>
    </header>

    <MustBeOnline v-if="!isOnline" message="Search requires an internet connection" />

    <template v-else>
    <div class="search-controls">
      <div class="search-input-wrapper">
        <span class="search-icon">🔍</span>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search emails..."
          class="search-input"
          @input="onSearchInput"
        />
      </div>

      <div class="filters">
        <!-- Sender filter -->
        <div class="sender-filter">
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

        <!-- Date filters -->
        <div class="date-filters">
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
        Searching...
      </div>

      <div v-else-if="results.length === 0 && !loading && (searchQuery.length >= 2 || senderId || dateFrom || dateTo)" class="no-results">
        No emails found
      </div>

      <div v-else-if="results.length > 0" class="results-list">
        <RouterLink
          v-for="result in results"
          :key="result.id"
          :to="`/thread/${result.threadId}`"
          class="result-item"
        >
          <div class="result-icon">✉️</div>
          <div class="result-content">
            <div class="result-title">{{ result.subject }}</div>
            <div class="result-meta">
              <span>{{ result.senderName || result.senderEmail }}</span>
              <span v-if="result.sentAt" class="result-date">
                {{ formatDate(result.sentAt) }}
              </span>
            </div>
            <div class="result-snippet">{{ result.snippet }}</div>
          </div>
        </RouterLink>
      </div>

      <div v-if="hasMore" class="load-more">
        <button @click="loadMore" :disabled="loading">
          {{ loading ? 'Loading...' : 'Load More' }}
        </button>
      </div>

      <div v-if="searchQuery.length < 2 && !senderId && !dateFrom && !dateTo && results.length === 0 && !loading" class="search-hint">
        Type at least 2 characters or select a filter
      </div>
    </div>
    </template>
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

.sender-filter {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sender-filter > label {
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
