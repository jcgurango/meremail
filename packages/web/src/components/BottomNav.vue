<script setup lang="ts">
import { useRouter, RouterLink } from 'vue-router'
import { uuid } from '@/local/uuid'

const router = useRouter()

function compose() {
  // A new draft gets its ID up front; it is only stored once something is written
  router.push(`/draft/${uuid()}`)
}
</script>

<template>
  <nav class="bottom-nav">
    <button class="nav-pill compose" @click="compose">
      <span class="nav-icon">✏️</span>
      <span class="nav-label">Compose</span>
    </button>
    <RouterLink to="/contacts" class="nav-pill contacts">
      <span class="nav-icon">👤</span>
      <span class="nav-label">Contacts</span>
    </RouterLink>
    <RouterLink to="/attachments" class="nav-pill attachments">
      <span class="nav-icon">📎</span>
      <span class="nav-label">Attachments</span>
    </RouterLink>
    <RouterLink to="/rules" class="nav-pill rules">
      <span class="nav-icon">⚙️</span>
      <span class="nav-label">Rules</span>
    </RouterLink>
    <RouterLink to="/folders" class="nav-pill folders">
      <span class="nav-icon">📁</span>
      <span class="nav-label">Folders</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.bottom-nav {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 12px;
  padding: 8px;
  background: var(--c-ffffff);
  border-radius: 24px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  z-index: 100;
}

.nav-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 20px;
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  transition: transform 0.15s, box-shadow 0.15s;
}

.nav-pill:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.nav-pill.compose {
  background: var(--c-dcfce7);
  color: var(--c-text-15803d);
  border: none;
  cursor: pointer;
}

.nav-pill.compose:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.nav-pill.contacts {
  background: var(--c-e0f2fe);
  color: var(--c-text-0369a1);
}

.nav-pill.attachments {
  background: var(--c-fef3c7);
  color: var(--c-text-b45309);
}

.nav-pill.rules {
  background: var(--c-f1f5f9);
  color: var(--c-text-475569);
}

.nav-pill.folders {
  background: var(--c-ecfdf5);
  color: var(--c-text-059669);
}

.nav-icon {
  font-size: 16px;
}

.nav-label {
  font-weight: 500;
}

.nav-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  background: var(--c-ef4444);
  color: var(--c-text-ffffff);
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
}

@media (max-width: 480px) {
  .bottom-nav {
    gap: 8px;
    padding: 6px;
  }

  .nav-pill {
    padding: 12px;
    border-radius: 50%;
  }

  .nav-label {
    display: none;
  }

  .nav-icon {
    font-size: 18px;
  }

  .nav-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 18px;
    height: 18px;
    font-size: 10px;
  }

  .nav-pill.contacts {
    position: relative;
  }
}
</style>
