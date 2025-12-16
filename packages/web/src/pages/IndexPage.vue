<script setup lang="ts">
import { computed, onMounted, watch, ref } from 'vue'
import ThreadList from '@/components/ThreadList.vue'
import FolderNav from '@/components/FolderNav.vue'
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
      <FolderNav :active-folder-id="currentFolderId" />
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

.main {
  padding: 0;
}
</style>
