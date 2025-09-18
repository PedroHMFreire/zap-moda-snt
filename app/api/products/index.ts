// app/api/products/index.ts
import { Pool } from 'pg';

let pool: Pool | null = null;
function getPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.QUEUE_DB_URL });
  return pool;
}
function getStoreId(req: any) {
  return req.headers['x-store-id'] || req.query.store_id || req.body?.store_id;
}

export default async function handler(req: any, res: any) {
  const db = getPool();
  const store_id = getStoreId(req);
  if (!store_id) return res.status(400).json({ error: 'store_id obrigatório.' });

  try {
    if (req.method === 'GET') {
      const q = (req.query.q || '').toString();
      const params: any[] = [store_id];
      let sql = `
        select id, name, price, category, description, images
        from products
        where store_id = $1
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
      const { name, price, category, description, images } = req.body || {};
      if (!name || typeof price !== 'number') {
        return res.status(400).json({ error: 'name e price são obrigatórios.' });
      }
      const r = await db.query(
        `insert into products (store_id, name, price, category, description, images)
         values ($1,$2,$3,$4,$5,$6)
         returning id, name, price, category, description, images`,
        [store_id, name, price, category || null, description || null, Array.isArray(images) ? images : []]
      );
      return res.status(201).json(r.rows[0]);
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
