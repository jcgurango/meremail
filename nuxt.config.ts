// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: ['@vite-pwa/nuxt'],

  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'MereMail',
      short_name: 'MereMail',
      description: 'A reimagined email experience',
      theme_color: '#ffffff',
      icons: [
        {
          src: 'pwa-192x192.png',
          sizes: '192x192',
          type: 'image/png',
        },
        {
          src: 'pwa-512x512.png',
          sizes: '512x512',
          type: 'image/png',
        },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
      runtimeCaching: [
        {
          // Cache HTML pages for offline navigation (matches routes without file extensions)
          urlPattern: /^\/(?:[^.]*)?$/,
          handler: 'NetworkFirst',
          options: {
            cacheName: 'pages-cache',
            networkTimeoutSeconds: 3,
            expiration: {
              maxEntries: 50,
              maxAgeSeconds: 60 * 60 * 24, // 24 hours
            },
          },
        },
        {
          // Contacts API - use cache first since we manage contacts in IndexedDB
          urlPattern: /\/api\/contacts(\?.*)?$/,
          handler: 'StaleWhileRevalidate',
          options: {
            cacheName: 'contacts-cache',
            expiration: {
              maxEntries: 50,
              maxAgeSeconds: 60 * 60 * 24, // 24 hours
            },
          },
        },
        {
          // Thread list API - prefer network but fall back to cache quickly
          urlPattern: /\/api\/threads(\?.*)?$/,
          handler: 'NetworkFirst',
          options: {
            cacheName: 'threads-cache',
            networkTimeoutSeconds: 3,
            expiration: {
              maxEntries: 50,
              maxAgeSeconds: 60 * 60, // 1 hour
            },
          },
        },
        {
          // Individual thread API
          urlPattern: /\/api\/threads\/\d+$/,
          handler: 'NetworkFirst',
          options: {
            cacheName: 'thread-detail-cache',
            networkTimeoutSeconds: 3,
            expiration: {
              maxEntries: 100,
              maxAgeSeconds: 60 * 60, // 1 hour
            },
          },
        },
        {
          // Attachments - cache first since they don't change
          urlPattern: /\/api\/attachments\/\d+$/,
          handler: 'CacheFirst',
          options: {
            cacheName: 'attachments-cache',
            expiration: {
              maxEntries: 200,
              maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
            },
          },
        },
        {
          // Set Aside feed
          urlPattern: /\/api\/set-aside(\?.*)?$/,
          handler: 'NetworkFirst',
          options: {
            cacheName: 'set-aside-cache',
            networkTimeoutSeconds: 3,
            expiration: {
              maxEntries: 10,
              maxAgeSeconds: 60 * 60, // 1 hour
            },
          },
        },
        {
          // Image proxy - cache first
          urlPattern: /\/api\/proxy-image(\?.*)?$/,
          handler: 'CacheFirst',
          options: {
            cacheName: 'image-proxy-cache',
            expiration: {
              maxEntries: 500,
              maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
            },
          },
        },
      ],
    },
    client: {
      installPrompt: true,
    },
    devOptions: {
      enabled: true,
      type: 'module',
    },
  },
})
