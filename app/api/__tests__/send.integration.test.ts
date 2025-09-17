import { describe, it, expect } from 'vitest'
import request from 'supertest'
import sendApp from '../send'

// Lightweight auth middleware override via monkey patch: requireAuth reads (req as any).user
// We'll inject a user before hitting the handler by a tiny wrapper express app.
import express from 'express'

function testWrapper() {
  const wrapper = express()
  wrapper.use((req,res,next)=>{ ;(req as any).user = { id: 'tester' }; next() })
  wrapper.use('/api/send', sendApp)
  return wrapper
}

describe('POST /api/send integration', () => {
  const app = testWrapper()
  it('returns 400 on invalid payload (missing store_id)', async () => {
    const r = await request(app).post('/api/send').send({ to: '5511987654321', text: 'oi' })
    expect(r.status).toBe(400)
    expect(r.body.error).toBeDefined()
  })
})
