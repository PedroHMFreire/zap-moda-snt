// app/api/contacts/index.ts
import { Pool } from 'pg';
import { getUserFromAuthHeader } from '../../lib/auth';

let pool: Pool | null = null;
function getPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.QUEUE_DB_URL });
  return pool;
}
// store_id removido, agora usamos owner_id (do token)

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
        select id, name, phone, wa_id, last_interaction_at
        from contacts
        where owner_id = $1
      `;
      if (q) {
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
        sql += ` and (coalesce(name,'') ilike $2 or coalesce(phone,'') ilike $3 or coalesce(wa_id,'') ilike $4)`;
      }
      sql += ` order by coalesce(last_interaction_at, 'epoch') desc nulls last limit 50`;
      const r = await db.query(sql, params);
      return res.status(200).json(r.rows);
    }

    if (req.method === 'POST') {
      const { name, phone, wa_id } = req.body || {};
      if (!phone && !wa_id) return res.status(400).json({ error: 'phone ou wa_id obrigatório.' });
      const r = await db.query(
        `insert into contacts (owner_id, name, phone, wa_id, last_interaction_at)
         values ($1,$2,$3,$4, now())
         returning id, name, phone, wa_id, last_interaction_at`,
        [owner_id, name || null, phone || null, wa_id || null]
      );
      return res.status(201).json(r.rows[0]);
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e: any) {
    res.status(500).json({ error: 'internal_error' });
  }
}
