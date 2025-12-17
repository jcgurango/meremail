<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { getMeContacts, createDraft } from '@/utils/api'

const router = useRouter()
const composing = ref(false)

async function compose() {
  if (composing.value) return
  composing.value = true

  try {
    // Use offline-aware getMeContacts
    const { data } = await getMeContacts()
    const senderId = data.contacts[0]?.id
    if (!senderId) {
      alert('No sender identity found. Please sync while online first.')
      return
    }

    // Create draft (works offline with negative IDs)
    const result = await createDraft({ senderId })

    // Navigate to draft page (handles both positive and negative IDs)
    router.push(`/draft/${result.draftId}`)
  } catch (e) {
    console.error('Failed to create draft:', e)
    alert('Failed to create new message')
  } finally {
    composing.value = false
  }
}
</script>

<template>
  <nav class="bottom-nav">
    <button class="nav-pill compose" @click="compose" :disabled="composing">
      <span class="nav-icon">✏️</span>
      <span class="nav-label">{{ composing ? 'Creating...' : 'Compose' }}</span>
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

.nav-pill.contacts {
  background: #e0f2fe;
  color: #0369a1;
}

.nav-pill.attachments {
  background: #fef3c7;
  color: #b45309;
}

.nav-pill.rules {
  background: #f1f5f9;
  color: #475569;
}

.nav-pill.folders {
  background: #ecfdf5;
  color: #059669;
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
