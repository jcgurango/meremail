import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
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
            urlPattern: /^\/(?:[^.]*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages-cache',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24,
              },
            },
          },
          {
            urlPattern: /\/api\/contacts(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'contacts-cache',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24,
              },
            },
          },
          {
            // /api/contacts/me - identities for EmailComposer "From" dropdown
            urlPattern: /\/api\/contacts\/me$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'identities-cache',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 5,
                maxAgeSeconds: 60 * 60 * 24,
              },
            },
          },
          {
            // /api/contacts/:id - individual contact details
            urlPattern: /\/api\/contacts\/\d+(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'contact-detail-cache',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24,
              },
            },
          },
          {
            urlPattern: /\/api\/threads(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'threads-cache',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60,
              },
            },
          },
          {
            urlPattern: /\/api\/threads\/\d+$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'thread-detail-cache',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60,
              },
            },
          },
          {
            urlPattern: /\/api\/drafts\/\d+$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'drafts-cache',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60,
              },
            },
          },
          {
            urlPattern: /\/api\/attachments\/\d+$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'attachments-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
            },
          },
          {
            urlPattern: /\/api\/set-aside(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'set-aside-cache',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60,
              },
            },
          },
          {
            urlPattern: /\/api\/proxy-image(\?.*)?$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-proxy-cache',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
