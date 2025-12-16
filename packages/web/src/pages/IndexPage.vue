<script setup lang="ts">
import { computed, onMounted, watch, ref } from 'vue'
import { RouterLink } from 'vue-router'
import ThreadList from '@/components/ThreadList.vue'
import { getFolders } from '@/utils/api'

const props = defineProps<{
  folderId?: number
  name?: string  // Folder name from route param
}>()

// Dynamic folder data
interface Folder {
  id: number
  name: string
  imapFolder: string | null
  position: number
  unreadCount: number
}

const folders = ref<Folder[]>([])
const foldersLoaded = ref(false)

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

// Icon mapping for folders
function getFolderIcon(folder: Folder): string {
  const name = folder.name.toLowerCase()
  if (name === 'inbox') return '📥'
  if (name === 'junk' || name === 'spam') return '🗑️'
  if (name === 'sent') return '📤'
  if (name === 'drafts') return '📝'
  if (name === 'archive') return '📦'
  if (name === 'trash') return '🗑️'
  return '📁'
}

// Route for folder
function getFolderRoute(folder: Folder): string {
  if (folder.id === 1) return '/'
  return `/folder/${folder.name.toLowerCase()}`
}

async function loadFolders() {
  try {
    const result = await getFolders()
    folders.value = result.data.folders
    foldersLoaded.value = true
  } catch (e) {
    console.error('Failed to load folders:', e)
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
watch(() => props.name, () => {
  loadFolders()
})
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>{{ pageTitle }}</h1>
      <nav class="folder-nav">
        <RouterLink
          v-for="folder in folders"
          :key="folder.id"
          :to="getFolderRoute(folder)"
          class="folder-pill"
          :class="{ active: currentFolderId === folder.id }"
        >
          <span class="folder-icon">{{ getFolderIcon(folder) }}</span>
          <span class="folder-label">{{ folder.name }}</span>
          <span v-if="folder.unreadCount" class="folder-count">{{ folder.unreadCount }}</span>
        </RouterLink>
      </nav>
    </header>

    <main class="main">
      <ThreadList
        v-if="foldersLoaded"
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

.folder-nav {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.folder-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 20px;
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  color: #666;
  background: #f5f5f5;
  transition: all 0.15s;
}

.folder-pill:hover {
  background: #e5e5e5;
  color: #333;
}

.folder-pill.active {
  background: #1a1a1a;
  color: #fff;
}

.folder-icon {
  font-size: 14px;
}

.folder-label {
  font-weight: 500;
}

.folder-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  background: #ef4444;
  color: #fff;
  border-radius: 9px;
  font-size: 11px;
  font-weight: 600;
}

.folder-pill.active .folder-count {
  background: #fff;
  color: #1a1a1a;
}

.main {
  padding: 0;
}
</style>
