import type { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { supabaseServer } from './supabaseClient'

// Basic cache (in-memory) to reduce repeated getUser calls in burst traffic
const userCache = new Map<string, { user: any; exp: number }>()
const CACHE_TTL_MS = 30_000 // 30s

export function requireAuth() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'unauthorized' })
    const token = auth.substring('Bearer '.length).trim()
    if (!token) return res.status(401).json({ error: 'unauthorized' })

    const now = Date.now()
    const cached = userCache.get(token)
    if (cached && cached.exp > now) {
      ;(req as any).user = cached.user
      return next()
    }

    const sb = supabaseServer()
    const { data, error } = await sb.auth.getUser(token)
    if (error || !data.user) return res.status(401).json({ error: 'invalid token' })
    // Basic expiry check: if token has exp claim and is in past
    const exp = (data.user as any)?.exp ? (data.user as any).exp * 1000 : (now + CACHE_TTL_MS)
    if (exp < now) return res.status(401).json({ error: 'token expired' })
    userCache.set(token, { user: data.user, exp: now + CACHE_TTL_MS })
    ;(req as any).user = data.user
    next()
  }
}

/**
 * Helper para uso direto dentro de handlers serverless (sem registrar middleware Express).
 * Retorna o usuário ou null (não lança). Usa o mesmo cache leve de requireAuth().
 */
export async function getUserFromAuthHeader(req: any): Promise<any | null> {
  try {
    const auth = req.headers?.authorization
    if (!auth?.startsWith('Bearer ')) return null
    const token = auth.substring('Bearer '.length).trim()
    if (!token) return null
    const now = Date.now()
    const cached = userCache.get(token)
    if (cached && cached.exp > now) return cached.user
    const sb = supabaseServer()
    const { data, error } = await sb.auth.getUser(token)
    if (error || !data.user) return null
    const exp = (data.user as any)?.exp ? (data.user as any).exp * 1000 : (now + CACHE_TTL_MS)
    if (exp < now) return null
    userCache.set(token, { user: data.user, exp: now + CACHE_TTL_MS })
    return data.user
  } catch {
    return null
  }
}


export function verifyInternalSignature(req: Request): boolean {
  const token = process.env.INTERNAL_WEBHOOK_TOKEN
  if (!token) return false
  const signature = (req.headers['x-inbound-signature'] as string || '').trim()
  if (!signature) return false
  const body = JSON.stringify(req.body || {})
  const h = crypto.createHmac('sha256', token).update(body).digest('hex')
  // length check before timingSafeEqual to avoid throw
  if (signature.length !== h.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(h))
  } catch {
    return false
  }
}
