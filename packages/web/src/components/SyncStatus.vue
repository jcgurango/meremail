<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { db, getMeta } from '@/local/db'
import { useLiveQuery } from '@/local/live'
import { isSyncing, isOnline, serverUnreachable, syncError, syncNow } from '@/local/sync'
import { formatRelativeTime } from '@/utils/format'

const { data: status } = useLiveQuery(async () => ({
  lastSyncedAt: (await getMeta('lastSyncedAt')) ?? null,
  pending: await db.actions.count(),
}), { lastSyncedAt: null as number | null, pending: 0 })

// Re-render the "x ago" text as time passes
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  timer = setInterval(() => { now.value = Date.now() }, 20 * 1000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})

const offline = computed(() => !isOnline.value || serverUnreachable.value)

const label = computed(() => {
  if (isSyncing.value) return 'Syncing…'
  const last = status.value.lastSyncedAt
  const synced = last ? `Synced ${formatRelativeTime(last, now.value)}` : 'Not synced yet'
  return offline.value ? `Offline · ${synced}` : synced
})

const title = computed(() => {
  const lines: string[] = []
  if (status.value.lastSyncedAt) {
    lines.push(`Last synced at ${new Date(status.value.lastSyncedAt).toLocaleString()}`)
  }
  if (status.value.pending > 0) {
    lines.push(`${status.value.pending} change${status.value.pending > 1 ? 's' : ''} waiting to be sent`)
  }
  if (syncError.value) lines.push(syncError.value)
  lines.push('Click to sync now')
  return lines.join('\n')
})

function sync() {
  now.value = Date.now()
  syncNow()
}
</script>

<template>
  <button
    class="sync-status"
    :class="{ syncing: isSyncing, offline, error: !!syncError && !isSyncing }"
    :title="title"
    :disabled="isSyncing"
    @click="sync"
  >
    <svg class="sync-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="23 4 23 10 17 10"></polyline>
      <polyline points="1 20 1 14 7 14"></polyline>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
    </svg>
    <span class="sync-label">{{ label }}</span>
    <span v-if="status.pending > 0" class="sync-pending">{{ status.pending }}</span>
  </button>
</template>

<style scoped>
.sync-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: none;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  color: #666;
  background: #f5f5f5;
  cursor: pointer;
  transition: all 0.15s;
}

.sync-status:hover:not(:disabled) {
  background: #e5e5e5;
  color: #333;
}

.sync-status:disabled {
  cursor: default;
}

.sync-status.offline {
  background: #fef2f2;
  color: #991b1b;
}

.sync-status.error {
  background: #fef3c7;
  color: #92400e;
}

.sync-status.syncing .sync-icon {
  animation: spin 1s linear infinite;
}

.sync-label {
  white-space: nowrap;
}

.sync-pending {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  background: #6b7280;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  border-radius: 9px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
