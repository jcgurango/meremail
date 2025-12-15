<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import SearchModal from '@/components/SearchModal.vue'

const router = useRouter()
const searchOpen = ref(false)
const composing = ref(false)
const unscreenedCount = ref(0)

async function loadUnscreenedCount() {
  try {
    const response = await fetch('/api/contacts?view=screener&limit=1&counts=true')
    if (response.ok) {
      const data = await response.json()
      unscreenedCount.value = data.counts?.unsorted || 0
    }
  } catch (e) {
    console.error('Failed to load unscreened count:', e)
  }
}

async function getDefaultSender(): Promise<number | null> {
  try {
    const response = await fetch('/api/contacts?isMe=true&limit=1')
    if (response.ok) {
      const data = await response.json()
      return data.contacts[0]?.id || null
    }
    return null
  } catch {
    return null
  }
}

async function compose() {
  if (composing.value) return
  composing.value = true

  try {
    const senderId = await getDefaultSender()
    if (!senderId) {
      alert('No sender identity found. Please import emails first.')
      return
    }

    const response = await fetch('/api/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senderId })
    })

    if (response.ok) {
      const result = await response.json()
      router.push(`/draft/${result.id}`)
    } else {
      throw new Error('Failed to create draft')
    }
  } catch (e) {
    console.error('Failed to create draft:', e)
    alert('Failed to create new message')
  } finally {
    composing.value = false
  }
}

onMounted(() => {
  loadUnscreenedCount()
})
</script>

<template>
  <nav class="bottom-nav">
    <button class="nav-pill compose" @click="compose" :disabled="composing">
      <span class="nav-icon">✏️</span>
      <span class="nav-label">{{ composing ? 'Creating...' : 'Compose' }}</span>
    </button>
    <button class="nav-pill search" @click="searchOpen = true">
      <span class="nav-icon">🔍</span>
      <span class="nav-label">Search</span>
    </button>
    <RouterLink to="/contacts" class="nav-pill contacts">
      <span class="nav-icon">👤</span>
      <span class="nav-label">Contacts</span>
      <span v-if="unscreenedCount > 0" class="nav-badge">{{ unscreenedCount }}</span>
    </RouterLink>
    <RouterLink to="/attachments" class="nav-pill attachments">
      <span class="nav-icon">📎</span>
      <span class="nav-label">Attachments</span>
    </RouterLink>
  </nav>

  <SearchModal :open="searchOpen" @close="searchOpen = false" />
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
  background: #fff;
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
  background: #dcfce7;
  color: #15803d;
  border: none;
  cursor: pointer;
}

.nav-pill.compose:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.nav-pill.search {
  background: #f3e8ff;
  color: #7c3aed;
  border: none;
  cursor: pointer;
}

.nav-pill.contacts {
  background: #e0f2fe;
  color: #0369a1;
}

.nav-pill.attachments {
  background: #fef3c7;
  color: #b45309;
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
  background: #ef4444;
  color: #fff;
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
