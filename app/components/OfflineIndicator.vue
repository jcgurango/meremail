<script setup lang="ts">
import { useOfflineStatus } from '~/composables/useOffline'

const { overallStatus, isOnline, hasPendingSync } = useOfflineStatus()

const statusConfig = computed(() => {
  switch (overallStatus.value) {
    case 'online':
      return { color: '#22c55e', label: 'Online', icon: '' }
    case 'syncing':
      return { color: '#f59e0b', label: 'Syncing...', icon: '' }
    case 'pending':
      return { color: '#f59e0b', label: 'Pending sync', icon: '' }
    case 'offline':
      return { color: '#ef4444', label: 'Offline', icon: '' }
    case 'error':
      return { color: '#ef4444', label: 'Sync error', icon: '' }
    default:
      return { color: '#6b7280', label: 'Unknown', icon: '' }
  }
})

// Only show indicator when not fully online
const showIndicator = computed(() => overallStatus.value !== 'online')
</script>

<template>
  <Transition name="slide">
    <div v-if="showIndicator" class="offline-indicator" :style="{ '--status-color': statusConfig.color }">
      <span class="status-dot" :class="{ pulse: overallStatus === 'syncing' }"></span>
      <span class="status-label">{{ statusConfig.label }}</span>
    </div>
  </Transition>
</template>

<style scoped>
.offline-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--status-color);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  border-radius: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.status-dot {
  width: 8px;
  height: 8px;
  background: #fff;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.pulse {
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(0.8);
  }
}

.status-label {
  white-space: nowrap;
}

/* Transition */
.slide-enter-active,
.slide-leave-active {
  transition: all 0.3s ease;
}

.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
