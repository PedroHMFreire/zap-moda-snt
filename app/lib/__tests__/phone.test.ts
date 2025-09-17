import { describe, it, expect } from 'vitest'
import { normalizePhone, isValidPhone } from '../phone'

describe('phone utils', () => {
  it('normalizes removing non-digits and leading zeros', () => {
    expect(normalizePhone('+55 (11) 9 8765-4321')).toBe('5511987654321')
  })
  it('validates basic brazilian length', () => {
    expect(isValidPhone('5511987654321')).toBe(true)
    expect(isValidPhone('123')).toBe(false)
  })
})
