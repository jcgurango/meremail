<script setup lang="ts">
import { useOffline } from '@/composables/useOffline'

defineProps<{
  message?: string
  inline?: boolean
}>()

const { isOnline } = useOffline()
</script>

<template>
  <slot v-if="isOnline" />
  <div v-else :class="['offline-message', { inline }]">
    <span class="offline-icon">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3a4.237 4.237 0 0 0-6 0zm-4-4l2 2a7.074 7.074 0 0 1 10 0l2-2C15.14 9.14 8.87 9.14 5 13z"/>
        <path d="M2 2L22 22" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
      </svg>
    </span>
    <p class="offline-text">{{ message || 'This feature requires an internet connection' }}</p>
  </div>
</template>

<style scoped>
.offline-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
  background: #f9fafb;
  border-radius: 8px;
  margin: 20px;
}

.offline-message.inline {
  flex-direction: row;
  padding: 12px 16px;
  margin: 0;
  gap: 8px;
  background: #fef3c7;
  border: 1px solid #fde68a;
}

.offline-icon {
  width: 48px;
  height: 48px;
  color: #9ca3af;
  margin-bottom: 12px;
}

.inline .offline-icon {
  width: 20px;
  height: 20px;
  margin-bottom: 0;
  color: #92400e;
}

.offline-text {
  color: #6b7280;
  font-size: 14px;
  margin: 0;
  max-width: 300px;
}

.inline .offline-text {
  color: #92400e;
  font-size: 13px;
}
</style>
