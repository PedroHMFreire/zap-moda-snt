import { describe, it, expect } from 'vitest'
import { cache } from '../cache'

// Use a short TTL specifically for the test by temporarily setting value

describe('cache utility', () => {
  it('stores and retrieves value before expiry', async () => {
    cache.set('k1', 123, 50)
    expect(cache.get<number>('k1')).toBe(123)
  })
  it('wrap caches function result', async () => {
    let calls = 0
    const v = await cache.wrap('k2', 100, async () => { calls++; return 42 })
    const v2 = await cache.wrap('k2', 100, async () => { calls++; return 99 })
    expect(v).toBe(42)
    expect(v2).toBe(42)
    expect(calls).toBe(1)
  })
})
