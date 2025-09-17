import { createClient } from '@supabase/supabase-js'
import { Pool } from 'pg'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import pino from 'pino'
import { randomUUID } from 'crypto'

// Simple in-function cache to avoid hammering DB if spammed
let lastResult: any = null
let lastFetched = 0
const CACHE_MS = 5000

interface JobMetric {
  name: string
  state: string
  count: number
}

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rid = (req.headers['x-request-id'] as string) || randomUUID()
  res.setHeader('x-request-id', rid)
  logger.info({ rid }, 'metrics:request:start')
  const token = req.headers['x-internal-metrics-token'] as string | undefined
  if (!token || token !== process.env.INTERNAL_METRICS_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  if (!process.env.QUEUE_DB_URL) {
    return res.status(503).json({ error: 'queue db not configured' })
  }

  // Basic caching
  if (Date.now() - lastFetched < CACHE_MS && lastResult) {
    return res.json(lastResult)
  }

  const pool = new Pool({ connectionString: process.env.QUEUE_DB_URL })
  try {
    const client = await pool.connect()
    try {
      // pg-boss tables: queue, archive, schedule, version, etc.
      // We focus on current jobs states from queue table.
      // States: created -> retry -> active -> completed/failed/expired
      const q = await client.query<{
        name: string; state: string; ct: string
      }>(`select name, state, count(*)::text as ct from boss.job group by name, state`)

      const rows: JobMetric[] = q.rows.map(r => ({ name: r.name, state: r.state, count: parseInt(r.ct, 10) }))

      // Aggregate by name
      const byName: Record<string, Record<string, number>> = {}
      for (const r of rows) {
        if (!byName[r.name]) byName[r.name] = {}
        byName[r.name][r.state] = r.count
      }

      // Overall counts by state
      const overall: Record<string, number> = {}
      for (const r of rows) {
        overall[r.state] = (overall[r.state] || 0) + r.count
      }

      lastResult = {
        generated_at: new Date().toISOString(),
        overall,
        jobs: byName
      }
      lastFetched = Date.now()
      return res.json(lastResult)
    } finally {
      client.release()
    }
  } catch (e: any) {
  logger.error({ err: e, rid }, 'metrics query failed')
  return res.status(500).json({ error: 'metrics query failed', detail: e.message })
  } finally {
    await pool.end().catch(() => {})
    logger.info({ rid }, 'metrics:request:finish')
  }
}
