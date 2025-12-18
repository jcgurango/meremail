<script setup lang="ts">
import { ref, watch, computed } from 'vue'

interface Contact {
  id: number
  name: string | null
  email: string
}

interface Folder {
  id: number
  name: string
}

export interface SearchFilters {
  query: string
  senderId: number | null
  senderName: string | null
  dateFrom: string
  dateTo: string
  sortBy: 'relevance' | 'date'
  folderIds: number[]  // empty array means all folders
}

const props = defineProps<{
  folderId?: number
  folders: Folder[]
}>()

const emit = defineEmits<{
  (e: 'search', filters: SearchFilters): void
  (e: 'clear'): void
}>()

// Search state
const searchQuery = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const sortBy = ref<'relevance' | 'date'>('relevance')
const selectedFolderIds = ref<Set<number>>(new Set(props.folderId ? [props.folderId] : []))
const showFolderDropdown = ref(false)

// Sender filter state
const senderSearch = ref('')
const senderResults = ref<Contact[]>([])
const senderSearchLoading = ref(false)
const selectedSender = ref<Contact | null>(null)
const showSenderDropdown = ref(false)
let senderDebounce: ReturnType<typeof setTimeout> | null = null

// Track if any filters are active
const hasActiveFilters = computed(() => {
  return searchQuery.value.length >= 2 ||
    selectedSender.value !== null ||
    dateFrom.value !== '' ||
    dateTo.value !== ''
})

// Folder selection display text
const folderDisplayText = computed(() => {
  if (selectedFolderIds.value.size === 0) return 'All folders'
  if (selectedFolderIds.value.size === props.folders.length) return 'All folders'
  if (selectedFolderIds.value.size === 1) {
    const id = [...selectedFolderIds.value][0]
    return props.folders.find(f => f.id === id)?.name ?? 'Selected'
  }
  return `${selectedFolderIds.value.size} folders`
})

function toggleFolder(folderId: number) {
  const newSet = new Set(selectedFolderIds.value)
  if (newSet.has(folderId)) {
    newSet.delete(folderId)
  } else {
    newSet.add(folderId)
  }
  selectedFolderIds.value = newSet
  emitSearch()
}

function selectAllFolders() {
  selectedFolderIds.value = new Set()
  emitSearch()
}

function isFolderSelected(folderId: number): boolean {
  // If no folders selected, all are effectively selected
  if (selectedFolderIds.value.size === 0) return true
  return selectedFolderIds.value.has(folderId)
}

// Emit search when filters change
function emitSearch() {
  if (!hasActiveFilters.value) {
    emit('clear')
    return
  }

  emit('search', {
    query: searchQuery.value,
    senderId: selectedSender.value?.id ?? null,
    senderName: selectedSender.value?.name ?? selectedSender.value?.email ?? null,
    dateFrom: dateFrom.value,
    dateTo: dateTo.value,
    sortBy: sortBy.value,
    folderIds: [...selectedFolderIds.value],
  })
}

// Debounce search input
let searchDebounce: ReturnType<typeof setTimeout> | null = null
function onSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    emitSearch()
  }, 300)
}

// Watch filter changes (immediate, no debounce)
watch([dateFrom, dateTo, sortBy], () => {
  emitSearch()
})

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
        senderResults.value = data.contacts.map(c => ({ id: c.id, name: c.name, email: c.email }))
      }
    } catch {
      senderResults.value = []
    } finally {
      senderSearchLoading.value = false
    }
  }, 300)
}

function selectSender(contact: Contact) {
  selectedSender.value = contact
  senderSearch.value = ''
  senderResults.value = []
  showSenderDropdown.value = false
  emitSearch()
}

function clearSender() {
  selectedSender.value = null
  emitSearch()
}

function clearAllFilters() {
  searchQuery.value = ''
  selectedSender.value = null
  dateFrom.value = ''
  dateTo.value = ''
  sortBy.value = 'relevance'
  selectedFolderIds.value = new Set(props.folderId ? [props.folderId] : [])
  emit('clear')
}

function onFolderDropdownBlur(e: FocusEvent) {
  setTimeout(() => {
    if (!e.relatedTarget || !(e.relatedTarget as HTMLElement).closest('.folder-dropdown')) {
      showFolderDropdown.value = false
    }
  }, 150)
}

// Close dropdown when clicking outside
function onBlur(e: FocusEvent) {
  // Delay to allow click events on dropdown items
  setTimeout(() => {
    if (!e.relatedTarget || !(e.relatedTarget as HTMLElement).closest('.sender-dropdown')) {
      showSenderDropdown.value = false
    }
  }, 150)
}
</script>

<template>
  <div class="search-toolbar">
    <div class="toolbar-row">
      <!-- Search input -->
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

      <!-- Clear all button -->
      <button
        v-if="hasActiveFilters"
        class="clear-all-btn"
        @click="clearAllFilters"
      >
        Clear
      </button>
    </div>

    <div class="toolbar-row filters-row">
      <!-- Folder filter -->
      <div class="filter-group folder-filter">
        <label>In</label>
        <div class="folder-select-wrapper">
          <button
            type="button"
            class="folder-select-btn"
            @click="showFolderDropdown = !showFolderDropdown"
            @blur="onFolderDropdownBlur"
          >
            <span>{{ folderDisplayText }}</span>
            <span class="dropdown-arrow">▾</span>
          </button>
          <div v-if="showFolderDropdown" class="folder-dropdown">
            <button
              type="button"
              class="folder-option"
              :class="{ selected: selectedFolderIds.size === 0 }"
              @mousedown.prevent="selectAllFolders"
            >
              <span class="check-box">{{ selectedFolderIds.size === 0 ? '✓' : '' }}</span>
              <span>All folders</span>
            </button>
            <div class="folder-divider"></div>
            <button
              v-for="folder in folders"
              :key="folder.id"
              type="button"
              class="folder-option"
              :class="{ selected: isFolderSelected(folder.id) && selectedFolderIds.size > 0 }"
              @mousedown.prevent="toggleFolder(folder.id)"
            >
              <span class="check-box">{{ selectedFolderIds.has(folder.id) ? '✓' : '' }}</span>
              <span>{{ folder.name }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- From filter -->
      <div class="filter-group sender-filter">
        <label>From</label>
        <div class="sender-input-wrapper">
          <div v-if="selectedSender" class="selected-sender">
            <span>{{ selectedSender.name || selectedSender.email }}</span>
            <button class="clear-btn" @click="clearSender">×</button>
          </div>
          <div v-else class="sender-search-wrapper">
            <input
              v-model="senderSearch"
              type="text"
              placeholder="Any sender"
              class="filter-input"
              @input="onSenderSearchInput"
              @focus="showSenderDropdown = true"
              @blur="onBlur"
            />
            <div v-if="showSenderDropdown && (senderResults.length > 0 || senderSearchLoading)" class="sender-dropdown">
              <div v-if="senderSearchLoading" class="dropdown-loading">Searching...</div>
              <button
                v-for="contact in senderResults"
                :key="contact.id"
                class="dropdown-option"
                @mousedown.prevent="selectSender(contact)"
              >
                <span class="option-name">{{ contact.name || contact.email }}</span>
                <span v-if="contact.name" class="option-email">{{ contact.email }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Date filter -->
      <div class="filter-group date-filter">
        <label>Date</label>
        <div class="date-inputs">
          <input type="date" v-model="dateFrom" class="filter-input date-input" />
          <span class="date-sep">–</span>
          <input type="date" v-model="dateTo" class="filter-input date-input" />
        </div>
      </div>

      <!-- Sort by -->
      <div class="filter-group" v-if="hasActiveFilters">
        <label>Sort</label>
        <select v-model="sortBy" class="filter-select">
          <option value="relevance">Relevance</option>
          <option value="date">Date</option>
        </select>
      </div>
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

.toolbar-row + .toolbar-row {
  margin-top: 10px;
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

.filters-row {
  flex-wrap: wrap;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.filter-group > label {
  font-size: 12px;
  color: #666;
  font-weight: 500;
}

.sender-filter {
  min-width: 180px;
}

.sender-input-wrapper {
  position: relative;
}

.sender-search-wrapper {
  position: relative;
}

.filter-input {
  padding: 5px 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
  background: #fff;
}

.filter-input:focus {
  outline: none;
  border-color: #999;
}

.date-inputs {
  display: flex;
  align-items: center;
  gap: 4px;
}

.date-input {
  width: 130px;
}

.date-sep {
  color: #999;
}

.sender-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  min-width: 200px;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 100;
  max-height: 200px;
  overflow-y: auto;
}

.dropdown-loading {
  padding: 10px 12px;
  color: #666;
  font-size: 13px;
}

.dropdown-option {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 8px 12px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
}

.dropdown-option:hover {
  background: #f5f5f5;
}

.option-name {
  font-size: 13px;
  color: #000;
}

.option-email {
  font-size: 11px;
  color: #666;
}

.selected-sender {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: #e5e5e5;
  border-radius: 4px;
  font-size: 13px;
}

.clear-btn {
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  padding: 0 2px;
  font-size: 16px;
  line-height: 1;
}

.clear-btn:hover {
  color: #000;
}

.filter-select {
  padding: 5px 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
  background: #fff;
}

.folder-filter {
  position: relative;
}

.folder-select-wrapper {
  position: relative;
}

.folder-select-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
  background: #fff;
  cursor: pointer;
  min-width: 120px;
}

.folder-select-btn:hover {
  border-color: #999;
}

.dropdown-arrow {
  font-size: 10px;
  color: #666;
  margin-left: auto;
}

.folder-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 160px;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 100;
  max-height: 250px;
  overflow-y: auto;
  margin-top: 2px;
}

.folder-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
}

.folder-option:hover {
  background: #f5f5f5;
}

.folder-option.selected {
  background: #f0f7ff;
}

.folder-option .check-box {
  width: 16px;
  height: 16px;
  border: 1.5px solid #999;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #4338ca;
  flex-shrink: 0;
}

.folder-option.selected .check-box {
  border-color: #4338ca;
  background: #e0e7ff;
}

.folder-divider {
  height: 1px;
  background: #e5e5e5;
  margin: 4px 0;
}
</style>
