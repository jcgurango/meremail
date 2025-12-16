<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { getFolders, getUnreadCounts } from '@/utils/api'

const props = defineProps<{
  activeFolderId?: number
  activeQueue?: 'reply_later' | 'set_aside'
}>()

interface Folder {
  id: number
  name: string
  imapFolder: string | null
  position: number
  unreadCount: number
}

interface QueueCounts {
  reply_later: number
  set_aside: number
}

const folders = ref<Folder[]>([])
const queueCounts = ref<QueueCounts>({ reply_later: 0, set_aside: 0 })

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

async function loadData() {
  try {
    const [foldersResult, countsResult] = await Promise.all([
      getFolders(),
      getUnreadCounts(),
    ])
    folders.value = foldersResult.data.folders
    queueCounts.value = {
      reply_later: countsResult.data.reply_later,
      set_aside: countsResult.data.set_aside,
    }
  } catch (e) {
    console.error('Failed to load navigation data:', e)
  }
}

onMounted(() => {
  loadData()
})

// Reload when active item changes
watch([() => props.activeFolderId, () => props.activeQueue], () => {
  loadData()
})
</script>

<template>
  <nav class="folder-nav">
    <!-- Folder pills -->
    <RouterLink
      v-for="folder in folders"
      :key="folder.id"
      :to="getFolderRoute(folder)"
      class="nav-pill"
      :class="{ active: activeFolderId === folder.id && !activeQueue }"
    >
      <span class="nav-icon">{{ getFolderIcon(folder) }}</span>
      <span class="nav-label">{{ folder.name }}</span>
      <span v-if="folder.unreadCount" class="nav-count">{{ folder.unreadCount }}</span>
    </RouterLink>

    <!-- Separator -->
    <span class="nav-separator"></span>

    <!-- Reply Later -->
    <RouterLink
      to="/reply-later"
      class="nav-pill queue-pill"
      :class="{ active: activeQueue === 'reply_later' }"
    >
      <span class="nav-icon">⏰</span>
      <span class="nav-label">Reply Later</span>
      <span v-if="queueCounts.reply_later" class="nav-count">{{ queueCounts.reply_later }}</span>
    </RouterLink>

    <!-- Set Aside -->
    <RouterLink
      to="/set-aside"
      class="nav-pill queue-pill"
      :class="{ active: activeQueue === 'set_aside' }"
    >
      <span class="nav-icon">📌</span>
      <span class="nav-label">Set Aside</span>
      <span v-if="queueCounts.set_aside" class="nav-count">{{ queueCounts.set_aside }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.folder-nav {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.nav-pill {
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

.nav-pill:hover {
  background: #e5e5e5;
  color: #333;
}

.nav-pill.active {
  background: #1a1a1a;
  color: #fff;
}

.nav-separator {
  width: 1px;
  height: 24px;
  background: #e5e5e5;
  margin: 0 4px;
}

.queue-pill {
  background: #fef3c7;
  color: #92400e;
}

.queue-pill:hover {
  background: #fde68a;
  color: #78350f;
}

.queue-pill.active {
  background: #f59e0b;
  color: #fff;
}

.nav-icon {
  font-size: 14px;
}

.nav-label {
  font-weight: 500;
}

.nav-count {
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

.nav-pill.active .nav-count {
  background: #fff;
  color: #1a1a1a;
}

.queue-pill .nav-count {
  background: #d97706;
  color: #fff;
}

.queue-pill.active .nav-count {
  background: #fff;
  color: #92400e;
}
</style>
