type Entry<T> = { v: T; exp: number }

class TTLCache {
  private store = new Map<string, Entry<any>>()
  constructor(private defaultTtlMs: number) {}

  get<T>(key: string): T | undefined {
    const e = this.store.get(key)
    if (!e) return undefined
    if (Date.now() > e.exp) {
      this.store.delete(key)
      return undefined
    }
    return e.v as T
  }

  set<T>(key: string, value: T, ttlMs?: number) {
    const exp = Date.now() + (ttlMs ?? this.defaultTtlMs)
    this.store.set(key, { v: value, exp })
  }

  wrap<T>(key: string, ttlMs: number | undefined, fn: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key)
    if (cached !== undefined) return Promise.resolve(cached)
    return fn().then(val => { this.set(key, val, ttlMs); return val })
  }
}

const DEFAULT_TTL = Number(process.env.CACHE_DEFAULT_TTL_MS || 5000)
export const cache = new TTLCache(DEFAULT_TTL)
