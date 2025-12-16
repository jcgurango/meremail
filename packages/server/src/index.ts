import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

import { threadsRoutes } from './routes/threads'
import { contactsRoutes } from './routes/contacts'
import { draftsRoutes } from './routes/drafts'
import { attachmentsRoutes } from './routes/attachments'
import { uploadsRoutes } from './routes/uploads'
import { searchRoutes } from './routes/search'
import { miscRoutes } from './routes/misc'
import { authRoutes, requireAuth } from './routes/auth'
import { startSendQueueProcessor } from './services/send-queue'
import { startDailyScheduler } from './services/daily-scheduler'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = new Hono()

// Middleware
app.use('*', logger())
app.use('/api/*', cors())

// Auth routes (public - no auth required)
app.route('/api/auth', authRoutes)

// Health check (public)
app.get('/api/health', (c) => c.json({ status: 'ok' }))

// Protected API Routes - require authentication
app.use('/api/*', requireAuth())
app.route('/api/threads', threadsRoutes)
app.route('/api/contacts', contactsRoutes)
app.route('/api/drafts', draftsRoutes)
app.route('/api/attachments', attachmentsRoutes)
app.route('/api/uploads', uploadsRoutes)
app.route('/api/search', searchRoutes)
app.route('/api', miscRoutes)

// In production, serve the Vue app from packages/web/dist
if (process.env.NODE_ENV === 'production') {
  const webDistPath = resolve(__dirname, '../../web/dist')

  if (existsSync(webDistPath)) {
    // Serve static assets
    app.use('/*', serveStatic({ root: webDistPath }))

    // SPA fallback for client-side routing
    app.get('*', (c) => {
      const indexPath = resolve(webDistPath, 'index.html')
      if (existsSync(indexPath)) {
        const html = readFileSync(indexPath, 'utf-8')
        return c.html(html)
      }
      return c.text('Not found', 404)
    })
  }
}

const port = parseInt(process.env.PORT || '3000')

console.log(`MereMail server starting...`)
console.log(`  Mode: ${process.env.NODE_ENV || 'development'}`)
console.log(`  Port: ${port}`)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server running at http://localhost:${info.port}`)

  // Start background send queue processor
  startSendQueueProcessor()

  // Start daily scheduler (backups and quarantine cleanup)
  startDailyScheduler()
})

export default app
