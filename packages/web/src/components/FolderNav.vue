<script lang="ts">
import type { Navigation } from '@/local/queries'

// The last navigation shown, kept across page changes so the bar renders
// complete straight away instead of appearing a moment after the page does
let lastNavigation: Navigation = { folders: [], replyLaterCount: 0, setAsideCount: 0 }
</script>

<script setup lang="ts">
import { RouterLink } from 'vue-router'
import SyncStatus from '@/components/SyncStatus.vue'
import { useLiveQuery } from '@/local/live'
import { watch } from 'vue'
import { getNavigation, type FolderNavItem } from '@/local/queries'

defineProps<{
  activeFolderId?: number
  activeQueue?: 'reply_later' | 'set_aside'
}>()

const { data: nav } = useLiveQuery<Navigation>(getNavigation, lastNavigation)
watch(nav, (value) => {
  lastNavigation = value
})

// Icon mapping for folders
function getFolderIcon(folder: FolderNavItem): string {
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
function getFolderRoute(folder: FolderNavItem): string {
  if (folder.id === 1) return '/'
  return `/folder/${folder.name.toLowerCase()}`
}
</script>

<template>
  <nav class="folder-nav">
    <!-- Folder pills -->
    <RouterLink
      v-for="folder in nav.folders"
      :key="folder.id"
      :to="getFolderRoute(folder)"
      class="nav-pill"
      :class="{ active: activeFolderId === folder.id && !activeQueue }"
    >
      <span class="nav-icon">{{ getFolderIcon(folder) }}</span>
      <span class="nav-label">{{ folder.name }}</span>
      <span v-if="folder.showUnreadCount && folder.unreadCount" class="nav-count">{{ folder.unreadCount }}</span>
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
      <span v-if="nav.replyLaterCount" class="nav-count">{{ nav.replyLaterCount }}</span>
    </RouterLink>

    <!-- Set Aside -->
    <RouterLink
      to="/set-aside"
      class="nav-pill queue-pill"
      :class="{ active: activeQueue === 'set_aside' }"
    >
      <span class="nav-icon">📌</span>
      <span class="nav-label">Set Aside</span>
      <span v-if="nav.setAsideCount" class="nav-count">{{ nav.setAsideCount }}</span>
    </RouterLink>

    <SyncStatus class="nav-sync" />
  </nav>
</template>

<style scoped>
.nav-sync {
  margin-left: auto;
}

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
