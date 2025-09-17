import { describe, it, expect } from 'vitest'
import { sha256Base64 } from '../hash'

describe('hash util', () => {
  it('produces stable base64 output', () => {
    const a = sha256Base64('abc')
    const b = sha256Base64('abc')
    expect(a).toBe(b)
  })
  it('distinguishes different inputs', () => {
    const a = sha256Base64('abc')
    const b = sha256Base64('abd')
    expect(a).not.toBe(b)
  })
})
