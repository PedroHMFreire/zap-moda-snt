import type { Express } from 'express'

export function startHealth(app: Express) {
  app.get('/health', (req, res) => res.json({ ok: true }))
  app.get('/metrics', (req, res) => {
    // Minimal metrics placeholder
    res.set('Content-Type', 'text/plain')
    res.send('sessions_active 0\nqueue_send_backlog 0\n')
  })
}
