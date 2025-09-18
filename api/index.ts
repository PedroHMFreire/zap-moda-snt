// Aggregated single serverless function exposing all routes to stay under Hobby plan limit.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parse } from 'url';

// Lazy import route modules to avoid cold start cost loading everything at once unnecessarily
type Handler = (req: any, res: any) => Promise<any> | any;

interface RouteDef { method: string; path: RegExp; handler: () => Promise<{ default: Handler }>; }

const routes: RouteDef[] = [
  { method: 'POST', path: /^\/api\/send$/, handler: () => import('../app/server/routes/send') },
  { method: 'POST', path: /^\/api\/ai\/reply$/, handler: () => import('../app/server/routes/reply') },
  { method: 'POST', path: /^\/api\/stores\/bootstrap$/, handler: () => import('../app/server/routes/bootstrap') },
  { method: 'GET',  path: /^\/api\/config$/, handler: () => import('../app/server/routes/config') },
  { method: 'GET',  path: /^\/api\/contacts$/, handler: () => import('../app/server/routes/contacts') },
  { method: 'POST', path: /^\/api\/contacts$/, handler: () => import('../app/server/routes/contacts') },
  { method: 'GET',  path: /^\/api\/products$/, handler: () => import('../app/server/routes/products') },
  { method: 'POST', path: /^\/api\/products$/, handler: () => import('../app/server/routes/products') },
  { method: 'POST', path: /^\/api\/sessions\/create$/, handler: () => import('../app/server/routes/create') },
  { method: 'POST', path: /^\/api\/sessions\/disconnect$/, handler: () => import('../app/server/routes/disconnect') },
  { method: 'GET',  path: /^\/api\/sessions\/qr$/, handler: () => import('../app/server/routes/qr') },
  { method: 'GET',  path: /^\/api\/sessions\/status$/, handler: () => import('../app/server/routes/status') },
  { method: 'POST', path: /^\/api\/inbound$/, handler: () => import('../app/server/routes/inbound') },
  { method: 'GET',  path: /^\/api\/health$/, handler: () => import('../app/server/routes/health') },
];

function matchRoute(method: string, pathname: string): RouteDef | undefined {
  return routes.find(r => r.method === method && r.path.test(pathname));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const parsed = parse(req.url || '');
  const pathname = parsed.pathname || '';
  const method = (req.method || 'GET').toUpperCase();
  const route = matchRoute(method, pathname);
  if (!route) {
    if (pathname.startsWith('/api/')) {
      return res.status(404).json({ error: 'not_found' });
    }
    // Fallback: simple root/index
    return res.status(200).json({ ok: true });
  }
  try {
    const mod = await route.handler();
    return mod.default(req as any, res as any);
  } catch (e: any) {
    return res.status(500).json({ error: 'internal_error' });
  }
}
