export function normalizePhone(raw: string, defaultCountryCode = '+55'): string {
  if (!raw) return ''
  // Keep digits only
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  // If already starts with country code digits (55...) and length > 11 keep
  // Brazil pattern: up to 13 digits with country code (55 + 2 DDD + 9 number)
  if (digits.startsWith('55') && digits.length >= 12) {
    return '+' + digits
  }
  // If length is 10-11 assume national and prepend country code
  if (digits.length >= 9 && digits.length <= 11) {
    return defaultCountryCode + digits
  }
  // Fallback: return with plus
  return '+' + digits
}

export function isValidPhone(normalized: string): boolean {
  // Very light validation: starts with +, min 11 digits total (country+number)
  return /^\+\d{11,16}$/.test(normalized)
}