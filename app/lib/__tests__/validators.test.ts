import { describe, it, expect } from 'vitest'
import { sendSchema } from '../validators'

describe('validators', () => {
  it('rejects invalid payload (missing store_id)', () => {
    const r = sendSchema.safeParse({ to: '5511987654321', text: 'oi' })
    expect(r.success).toBe(false)
  })
  it('accepts minimal valid payload', () => {
    const r = sendSchema.safeParse({ store_id: 's1', to: '5511987654321', text: 'oi', session_id: 'sess1' })
    expect(r.success).toBe(true)
  })
})
