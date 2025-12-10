<script setup lang="ts">
const route = useRoute()
const router = useRouter()

// Get initial values from URL
const searchQuery = ref((route.query.q as string) || '')
const selectedType = ref<string | null>((route.query.fileType as string) || null)
const selectedContactId = ref<number | null>(route.query.contactId ? Number(route.query.contactId) : null)

useHead({ title: 'Attachments - MereMail' })

// Sync filters to URL
function updateUrl() {
  const query: Record<string, string> = {}
  if (searchQuery.value.trim()) query.q = searchQuery.value.trim()
  if (selectedType.value) query.fileType = selectedType.value
  if (selectedContactId.value) query.contactId = String(selectedContactId.value)
  router.replace({ query })
}

interface Sender {
  id: number
  name: string | null
  email: string
}

interface Attachment {
  id: number
  filename: string
  mimeType: string | null
  size: number | null
  threadId: number
  threadSubject: string
  sentAt: string
  sender: Sender | null
}

interface FilterContact {
  id: number
  name: string | null
  email: string
}

interface ApiResponse {
  attachments: Attachment[]
  hasMore: boolean
  filters: {
    categories: Record<string, number>
    contacts: FilterContact[]
  }
}

const attachments = ref<Attachment[]>([])
const hasMore = ref(false)
const categories = ref<Record<string, number>>({})
const filterContacts = ref<FilterContact[]>([])
const loading = ref(false)

// Active filters (selectedType and selectedContactId initialized above from URL)
const contactSearch = ref('')
const searchingContacts = ref(false)
const typeDropdownOpen = ref(false)
const contactDropdownOpen = ref(false)
const typeDropdown = ref<HTMLElement | null>(null)
const contactDropdown = ref<HTMLElement | null>(null)

// Click outside to close dropdowns
function handleClickOutside(e: MouseEvent) {
  if (typeDropdown.value && !typeDropdown.value.contains(e.target as Node)) {
    typeDropdownOpen.value = false
  }
  if (contactDropdown.value && !contactDropdown.value.contains(e.target as Node)) {
    contactDropdownOpen.value = false
    if (contactSearch.value) {
      contactSearch.value = ''
      searchContacts('')
    }
  }
}

function toggleTypeDropdown() {
  typeDropdownOpen.value = !typeDropdownOpen.value
  contactDropdownOpen.value = false
}

function toggleContactDropdown() {
  contactDropdownOpen.value = !contactDropdownOpen.value
  typeDropdownOpen.value = false
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})

// Debounce helpers
let searchTimeout: ReturnType<typeof setTimeout> | null = null
let textSearchTimeout: ReturnType<typeof setTimeout> | null = null

async function searchContacts(query: string) {
  searchingContacts.value = true
  try {
    const params = new URLSearchParams({ limit: '1', contactSearch: query })
    // If there's a text search, pass it so contacts are filtered to those with matching attachments
    if (searchQuery.value.trim()) {
      params.set('q', searchQuery.value.trim())
    }
    const data = await $fetch<ApiResponse>(`/api/attachments?${params}`)
    filterContacts.value = data.filters.contacts
  } finally {
    searchingContacts.value = false
  }
}

function onContactSearchInput() {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    searchContacts(contactSearch.value)
  }, 300)
}

function onTextSearchInput() {
  if (textSearchTimeout) clearTimeout(textSearchTimeout)
  textSearchTimeout = setTimeout(() => {
    updateUrl()
    loadAttachments(true)
  }, 300)
}

// Category labels
const categoryLabels: Record<string, string> = {
  images: 'Images',
  videos: 'Videos',
  audio: 'Audio',
  documents: 'Documents',
  spreadsheets: 'Spreadsheets',
  presentations: 'Presentations',
  archives: 'Archives',
}

async function loadAttachments(reset = false) {
  if (loading.value) return
  loading.value = true

  try {
    const offset = reset ? 0 : attachments.value.length
    const params = new URLSearchParams({ limit: '50', offset: String(offset) })

    if (searchQuery.value.trim()) {
      params.set('q', searchQuery.value.trim())
    }
    if (selectedType.value) {
      params.set('fileType', selectedType.value)
    }
    if (selectedContactId.value) {
      params.set('contactId', String(selectedContactId.value))
    }

    const data = await $fetch<ApiResponse>(`/api/attachments?${params}`)

    if (reset) {
      attachments.value = data.attachments
    } else {
      attachments.value.push(...data.attachments)
    }
    hasMore.value = data.hasMore
    categories.value = data.filters.categories
    filterContacts.value = data.filters.contacts
  } finally {
    loading.value = false
  }
}

// Watch filter changes
watch([selectedType, selectedContactId], () => {
  updateUrl()
  loadAttachments(true)
})

// Initial load
loadAttachments(true)

function getFileIcon(mimeType: string | null, filename: string): string {
  if (mimeType) {
    if (mimeType.startsWith('image/')) return '🖼'
    if (mimeType.startsWith('video/')) return '🎬'
    if (mimeType.startsWith('audio/')) return '🎵'
    if (mimeType === 'application/pdf') return '📄'
    if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive')) return '📦'
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊'
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📽'
    if (mimeType.includes('document') || mimeType.includes('word')) return '📝'
  }

  const ext = filename.split('.').pop()?.toLowerCase()
  const extMap: Record<string, string> = {
    pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
    ppt: '📽', pptx: '📽', zip: '📦', rar: '📦', '7z': '📦',
    jpg: '🖼', jpeg: '🖼', png: '🖼', gif: '🖼', webp: '🖼',
    mp4: '🎬', mov: '🎬', avi: '🎬', mp3: '🎵', wav: '🎵',
    txt: '📃', md: '📃', json: '📃', html: '🌐', css: '🌐',
    js: '⚙', ts: '⚙', py: '⚙', java: '⚙', c: '⚙',
  }
  return extMap[ext || ''] || '📎'
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short' })
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getSelectedContactName(): string {
  if (!selectedContactId.value) return 'Everyone'
  const contact = filterContacts.value.find(c => c.id === selectedContactId.value)
  if (!contact) return 'Everyone'
  return contact.name || contact.email.split('@')[0]
}

function clearTypeFilter() {
  selectedType.value = null
}

function clearContactFilter() {
  selectedContactId.value = null
}
</script>

<template>
  <div class="attachments-page">
    <header class="page-header">
      <NuxtLink to="/" class="back-link">&larr; Threads</NuxtLink>
      <h1>Attachments</h1>
    </header>

    <div class="search-box">
      <span class="search-icon">🔍</span>
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Search attachments..."
        class="search-input"
        @input="onTextSearchInput"
      />
    </div>

    <div class="filters">
      <div class="filter-group">
        <div class="filter-dropdown" :class="{ open: typeDropdownOpen }" ref="typeDropdown">
          <button class="filter-btn" :class="{ active: selectedType }" @click="toggleTypeDropdown">
            {{ selectedType ? categoryLabels[selectedType] : 'All files' }}
            <span class="arrow">▾</span>
          </button>
          <div class="dropdown-menu">
            <button
              v-if="selectedType"
              class="dropdown-item clear"
              @click="clearTypeFilter(); typeDropdownOpen = false"
            >
              All files
            </button>
            <button
              v-for="(count, category) in categories"
              :key="category"
              class="dropdown-item"
              :class="{ selected: selectedType === category }"
              @click="selectedType = category; typeDropdownOpen = false"
            >
              {{ categoryLabels[category] || category }}
              <span class="count">{{ count }}</span>
            </button>
          </div>
        </div>

        <div class="filter-dropdown" :class="{ open: contactDropdownOpen }" ref="contactDropdown">
          <button class="filter-btn" :class="{ active: selectedContactId }" @click="toggleContactDropdown">
            {{ getSelectedContactName() }}
            <span class="arrow">▾</span>
          </button>
          <div class="dropdown-menu contacts-menu">
            <div class="contact-search-box">
              <input
                v-model="contactSearch"
                type="text"
                placeholder="Search contacts..."
                class="contact-search-input"
                @input="onContactSearchInput"
              />
            </div>
            <button
              v-if="selectedContactId"
              class="dropdown-item clear"
              @click="clearContactFilter(); contactDropdownOpen = false"
            >
              Everyone
            </button>
            <div class="contacts-list">
              <div v-if="searchingContacts" class="searching">
                Searching...
              </div>
              <template v-else>
                <button
                  v-for="contact in filterContacts"
                  :key="contact.id"
                  class="dropdown-item contact-item"
                  :class="{ selected: selectedContactId === contact.id }"
                  @click="selectedContactId = contact.id; contactDropdownOpen = false"
                >
                  <span class="contact-name">{{ contact.name || contact.email.split('@')[0] }}</span>
                  <span class="contact-email">{{ contact.email }}</span>
                </button>
                <div v-if="filterContacts.length === 0" class="no-results">
                  No contacts found
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="attachments.length === 0 && !loading" class="empty-state">
      No attachments found
    </div>

    <div class="attachments-list">
      <NuxtLink
        v-for="attachment in attachments"
        :key="attachment.id"
        :to="`/attachment/${attachment.id}`"
        class="attachment-item"
      >
        <div class="attachment-icon">{{ getFileIcon(attachment.mimeType, attachment.filename) }}</div>
        <div class="attachment-info">
          <div class="filename">{{ attachment.filename }}</div>
          <div class="thread-subject">
            {{ attachment.threadSubject }}
          </div>
          <div class="meta">
            <span v-if="attachment.size" class="size">{{ formatFileSize(attachment.size) }}</span>
            <span v-if="attachment.size" class="dot">·</span>
            <span class="date">{{ formatShortDate(attachment.sentAt) }}</span>
          </div>
        </div>
      </NuxtLink>
    </div>

    <div v-if="hasMore" class="load-more">
      <button @click="loadAttachments(false)" :disabled="loading">
        {{ loading ? 'Loading...' : 'Load More' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.attachments-page {
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

.search-box {
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
  margin-bottom: 24px;
}

.filter-group {
  display: flex;
  gap: 12px;
}

.filter-dropdown {
  position: relative;
}

.filter-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
}

.filter-btn:hover {
  border-color: #999;
}

.filter-btn.active {
  background: #f0f0f0;
  border-color: #999;
}

.filter-btn .arrow {
  font-size: 10px;
  color: #666;
}

.dropdown-menu {
  display: none;
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  min-width: 180px;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  z-index: 100;
  max-height: 300px;
  overflow-y: auto;
}

.contacts-menu {
  min-width: 240px;
  max-height: none;
  overflow: visible;
}

.contact-search-box {
  padding: 8px;
  border-bottom: 1px solid #eee;
}

.contact-search-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  outline: none;
}

.contact-search-input:focus {
  border-color: #999;
}

.contacts-list {
  max-height: 250px;
  overflow-y: auto;
}

.contact-item {
  flex-direction: column;
  align-items: flex-start !important;
  gap: 2px;
}

.contact-name {
  font-weight: 500;
}

.contact-email {
  font-size: 12px;
  color: #666;
}

.no-results,
.searching {
  padding: 12px 14px;
  color: #999;
  font-size: 13px;
  text-align: center;
}

.filter-dropdown.open .dropdown-menu {
  display: block;
}

.dropdown-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: none;
  text-align: left;
  font-size: 14px;
  cursor: pointer;
}

.dropdown-item:hover {
  background: #f5f5f5;
}

.dropdown-item.selected {
  background: #f0f0f0;
  font-weight: 500;
}

.dropdown-item.clear {
  color: #666;
  border-bottom: 1px solid #eee;
}

.dropdown-item .count {
  color: #999;
  font-size: 12px;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #666;
}

.attachments-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: #eee;
  border-radius: 8px;
  overflow: hidden;
}

.attachment-item {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 16px;
  background: #fff;
  text-decoration: none;
  color: inherit;
  transition: background 0.15s;
}

.attachment-item:hover {
  background: #fafafa;
}

.attachment-icon {
  font-size: 28px;
  line-height: 1;
  flex-shrink: 0;
}

.attachment-info {
  flex: 1;
  min-width: 0;
}

.filename {
  font-weight: 500;
  font-size: 15px;
  margin-bottom: 4px;
  word-break: break-word;
}

.thread-subject {
  font-size: 13px;
  color: #666;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta {
  font-size: 12px;
  color: #999;
}

.meta .dot {
  margin: 0 6px;
}

.load-more {
  text-align: center;
  margin-top: 24px;
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
