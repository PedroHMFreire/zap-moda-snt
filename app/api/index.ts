// Aggregated single serverless entry inside app/api for Vercel (Root Directory = app)
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { parse } from 'url'

const routes = [
  { m: 'POST', r: /^\/api\/send$/, h: () => import('../server/routes/send') },
  { m: 'POST', r: /^\/api\/ai\/reply$/, h: () => import('../server/routes/reply') },
  { m: 'POST', r: /^\/api\/stores\/ensure$/, h: () => import('../server/routes/ensureStore') },
  { m: 'GET',  r: /^\/api\/config$/, h: () => import('../server/routes/config') },
  { m: 'GET',  r: /^\/api\/contacts$/, h: () => import('../server/routes/contacts') },
  { m: 'POST', r: /^\/api\/contacts$/, h: () => import('../server/routes/contacts') },
  { m: 'GET',  r: /^\/api\/products$/, h: () => import('../server/routes/products') },
  { m: 'POST', r: /^\/api\/products$/, h: () => import('../server/routes/products') },
  { m: 'POST', r: /^\/api\/sessions\/create$/, h: () => import('../server/routes/create') },
  { m: 'POST', r: /^\/api\/sessions\/disconnect$/, h: () => import('../server/routes/disconnect') },
  { m: 'GET',  r: /^\/api\/sessions\/qr$/, h: () => import('../server/routes/qr') },
  { m: 'GET',  r: /^\/api\/sessions\/status$/, h: () => import('../server/routes/status') },
  { m: 'POST', r: /^\/api\/inbound$/, h: () => import('../server/routes/inbound') },
  { m: 'GET',  r: /^\/api\/health$/, h: () => import('../server/routes/health') },
]

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const parsed = parse(req.url || '')
  const pathname = parsed.pathname || ''
  const method = (req.method || 'GET').toUpperCase()
  const route = routes.find(x => x.m === method && x.r.test(pathname))
  if (!route) {
    if (pathname.startsWith('/api/')) return res.status(404).json({ error: 'not_found' })
    return res.status(200).json({ ok: true })
  }
  try {
    const mod = await route.h()
    return mod.default(req as any, res as any)
  } catch (e) {
    return res.status(500).json({ error: 'internal_error' })
  }
}
