// app/api/products/index.ts
import { Pool } from 'pg';
import { getUserFromAuthHeader } from '../../lib/auth';
import { hitRateLimit } from '../../lib/rateLimit';

let pool: Pool | null = null;
function getPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.QUEUE_DB_URL });
  return pool;
}
// store_id removido

export default async function handler(req: any, res: any) {
  const db = getPool();
  try {
    const user = await getUserFromAuthHeader(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const owner_id = user.id;

    if (req.method === 'GET') {
      const q = (req.query.q || '').toString();
      const params: any[] = [owner_id];
      let sql = `
        select id, name, price, category, description, images
        from products
        where owner_id = $1
      `;
      if (q) {
        params.push(`%${q}%`, `%${q}%`);
        sql += ` and (coalesce(name,'') ilike $2 or coalesce(category,'') ilike $3)`;
      }
      sql += ` order by created_at desc limit 50`;
      const r = await db.query(sql, params);
      return res.status(200).json(r.rows);
    }

    if (req.method === 'POST') {
      // Rate limit criação de produtos
      try {
  const rl = await hitRateLimit(`rl:prod:create:${owner_id}`, 30, 300); // 30 em 5min
        res.setHeader('X-RateLimit-Limit', rl.limit.toString());
        res.setHeader('X-RateLimit-Remaining', rl.remaining.toString());
        res.setHeader('X-RateLimit-Reset', rl.reset.toString());
        if (!rl.allowed) return res.status(429).json({ error: 'rate limit exceeded' });
      } catch {/* falha silenciosa */}

      const { name, price, category, description, images } = req.body || {};
      if (!name || typeof price !== 'number') {
        return res.status(400).json({ error: 'name e price são obrigatórios.' });
      }
      if (price < 0) return res.status(400).json({ error: 'price inválido' });
      const desc = description && description.length > 4000 ? description.slice(0, 4000) : description;
      const r = await db.query(
        `insert into products (owner_id, name, price, category, description, images)
         values ($1,$2,$3,$4,$5,$6)
         returning id, name, price, category, description, images`,
        [owner_id, name, price, category || null, desc || null, Array.isArray(images) ? images : []]
      );
      return res.status(201).json(r.rows[0]);
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e: any) {
    res.status(500).json({ error: 'internal_error' });
  }
}
