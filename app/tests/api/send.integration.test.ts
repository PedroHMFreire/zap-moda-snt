import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import handler from '../../api'

// Wrap the single serverless handler in express for testing.
function testWrapper() {
  const app = express()
  app.use(express.json())
  app.all('*', (req, res) => handler(req as any, res as any))
  return app
}

describe('POST /api/send integration (aggregated)', () => {
  const app = testWrapper()
  it('returns 400 on missing store_id', async () => {
    const r = await request(app).post('/api/send').send({ to: '5511987654321', text: 'oi' })
    expect(r.status).toBe(400)
  })
})
