<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { setServerUrl } from '@/utils/native-config'
import { setApiBaseUrl } from '@/utils/api-url'
import { installFetchInterceptor } from '@/main'

const router = useRouter()

const serverUrl = ref('')
const error = ref('')
const testing = ref(false)
const success = ref(false)

function normalizeUrl(url: string): string {
  let normalized = url.trim()
  // Remove trailing slash
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }
  // Add https:// if no protocol
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized
  }
  return normalized
}

async function testConnection() {
  error.value = ''
  success.value = false

  const url = normalizeUrl(serverUrl.value)
  if (!url) {
    error.value = 'Please enter a server URL'
    return
  }

  testing.value = true
  try {
    const response = await fetch(`${url}/api/auth/me`, {
      method: 'GET',
      credentials: 'include',
    })
    // Any response (even 401) means the server is reachable
    if (response.status < 500) {
      success.value = true
    } else {
      error.value = `Server returned error: ${response.status}`
    }
  } catch (e) {
    error.value = 'Could not connect to server. Check the URL and try again.'
  } finally {
    testing.value = false
  }
}

async function handleSave() {
  const url = normalizeUrl(serverUrl.value)
  if (!url) {
    error.value = 'Please enter a server URL'
    return
  }

  await setServerUrl(url)
  setApiBaseUrl(url)
  installFetchInterceptor(url)
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="setup-page">
    <div class="setup-container">
      <div class="setup-header">
        <h1>MereMail</h1>
        <p>Connect to your server</p>
      </div>

      <div class="setup-form">
        <div v-if="error" class="error-message">
          {{ error }}
        </div>
        <div v-if="success" class="success-message">
          Connected successfully.
        </div>

        <div class="form-group">
          <label for="serverUrl">Server URL</label>
          <input
            id="serverUrl"
            v-model="serverUrl"
            type="url"
            placeholder="https://mail.example.com"
            autocomplete="url"
            autofocus
            :disabled="testing"
            @keydown.enter="testConnection"
          />
        </div>

        <button
          class="test-btn"
          :disabled="testing || !serverUrl.trim()"
          @click="testConnection"
        >
          {{ testing ? 'Testing...' : 'Test Connection' }}
        </button>

        <button
          class="save-btn"
          :disabled="!success"
          @click="handleSave"
        >
          Continue
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.setup-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
  padding: 20px;
}

.setup-container {
  width: 100%;
  max-width: 360px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  padding: 32px;
}

.setup-header {
  text-align: center;
  margin-bottom: 24px;
}

.setup-header h1 {
  margin: 0 0 8px 0;
  font-size: 24px;
  font-weight: 600;
  color: #111;
}

.setup-header p {
  margin: 0;
  color: #666;
  font-size: 14px;
}

.setup-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.error-message {
  padding: 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  color: #dc2626;
  font-size: 14px;
  text-align: center;
}

.success-message {
  padding: 12px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 6px;
  color: #16a34a;
  font-size: 14px;
  text-align: center;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 14px;
  font-weight: 500;
  color: #333;
}

.form-group input {
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.form-group input:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

.form-group input:disabled {
  background: #f9fafb;
  cursor: not-allowed;
}

.test-btn {
  padding: 12px;
  background: #fff;
  color: #333;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.test-btn:hover:not(:disabled) {
  background: #f9fafb;
}

.test-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.save-btn {
  padding: 12px;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.save-btn:hover:not(:disabled) {
  background: #1d4ed8;
}

.save-btn:disabled {
  background: #93c5fd;
  cursor: not-allowed;
}
</style>
