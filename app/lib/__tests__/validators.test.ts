import { describe, it, expect } from 'vitest'
import { sendSchema } from '../validators'

describe('validators', () => {
  it('rejects invalid payload (missing text and media)', () => {
    const r = sendSchema.safeParse({ to: '5511987654321' })
    expect(r.success).toBe(false)
  })
  it('accepts minimal valid payload (text)', () => {
    const r = sendSchema.safeParse({ to: '5511987654321', text: 'oi' })
    expect(r.success).toBe(true)
  })
})
