<script setup lang="ts">
import { computed } from 'vue'
import { useOfflineStatus } from '@/composables/useOffline'

const { overallStatus } = useOfflineStatus()

const statusConfig = computed(() => {
  if (overallStatus.value === 'offline') {
    return { color: '#ef4444', label: 'Offline' }
  }
  return { color: '#22c55e', label: 'Online' }
})

const showIndicator = computed(() => overallStatus.value === 'offline')
</script>

<template>
  <Transition name="slide">
    <div v-if="showIndicator" class="offline-indicator" :style="{ '--status-color': statusConfig.color }">
      <span class="status-dot"></span>
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

.status-label {
  white-space: nowrap;
}

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
