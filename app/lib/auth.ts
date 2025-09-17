import type { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { supabaseServer } from './supabaseClient'

export function requireAuth() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const auth = req.headers.authorization
    if (!auth) return res.status(401).json({ error: 'unauthorized' })
    const token = auth.replace('Bearer ', '')
    // A simple check: verify user by calling getUser on server client
    const sb = supabaseServer()
    const { data, error } = await sb.auth.getUser(token)
    if (error || !data.user) return res.status(401).json({ error: 'invalid token' })
    ;(req as any).user = data.user
    next()
  }
}

export function verifyInternalSignature(req: Request): boolean {
  const token = process.env.INTERNAL_WEBHOOK_TOKEN
  if (!token) return false
  const signature = req.headers['x-inbound-signature'] as string
  if (!signature) return false
  const body = JSON.stringify(req.body || {})
  const h = crypto.createHmac('sha256', token).update(body).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(h))
}
