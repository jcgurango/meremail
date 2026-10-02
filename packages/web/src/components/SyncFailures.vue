<script setup lang="ts">
import { db } from '@/local/db'
import { useLiveQuery } from '@/local/live'

// Changes the server refused. They have already been undone locally; this is
// just so they don't fail silently.
const { data: failures } = useLiveQuery(() => db.failures.orderBy('seq').toArray(), [])

function dismiss(seq: number | undefined) {
  if (seq !== undefined) db.failures.delete(seq)
}
</script>

<template>
  <div v-if="failures.length > 0" class="sync-failures">
    <div v-for="failure in failures" :key="failure.seq" class="failure">
      <div class="failure-text">
        <strong>{{ failure.subject }}</strong> couldn't be completed: {{ failure.error }}
      </div>
      <button class="failure-dismiss" title="Dismiss" @click="dismiss(failure.seq)">×</button>
    </div>
  </div>
</template>

<style scoped>
.sync-failures {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: 88px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  pointer-events: none;
}

.failure {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  max-width: 480px;
  padding: 10px 14px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #991b1b;
  font-size: 13px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  pointer-events: auto;
}

.failure-dismiss {
  border: none;
  background: none;
  color: inherit;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
</style>
