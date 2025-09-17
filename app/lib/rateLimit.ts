import { Pool } from 'pg'

let pool: Pool | null = null
function getPool() {
  if (!pool) {
    if (!process.env.QUEUE_DB_URL) throw new Error('QUEUE_DB_URL not configured for rate limiting')
    pool = new Pool({ connectionString: process.env.QUEUE_DB_URL })
  }
  return pool
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  limit: number
  reset: number // epoch ms
}

/**
 * Sliding window approximation using fixed windows.
 * key: unique identifier (e.g., rl:send:<store_id>)
 */
export async function hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const now = Date.now()
  const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000)
  const windowEnd = new Date(windowStart.getTime() + windowSeconds * 1000)
  const resetMs = windowEnd.getTime()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const upsert = `insert into application_rate_limits(key, window_start, window_end, counter)
      values($1,$2,$3,1)
      on conflict (key, window_start)
      do update set counter = application_rate_limits.counter + 1
      returning counter`;
    const { rows } = await client.query(upsert, [key, windowStart.toISOString(), windowEnd.toISOString()])
    await client.query('COMMIT')
    const count = parseInt(rows[0].counter, 10)
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      limit,
      reset: resetMs
    }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
