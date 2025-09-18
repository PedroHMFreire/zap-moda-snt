// app/api/sessions/qr/index.ts
import { Pool } from 'pg';
import { getUserFromAuthHeader, assertStoreOwnership } from '../../lib/auth';

let pool: Pool | null = null;
function db() {
  if (!pool) pool = new Pool({ connectionString: process.env.QUEUE_DB_URL });
  return pool!;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session_id = req.query.session_id || req.body?.session_id;
  if (!session_id) return res.status(400).json({ error: 'session_id obrigatório.' });

  try {
    const p = db();
    const user = await getUserFromAuthHeader(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const r = await p.query(
      `select last_qr, updated_at, status
         from whatsapp_sessions
        where id=$1
        limit 1`,
      [session_id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Sessão não encontrada' });
    const sessionRow = await p.query('select store_id from whatsapp_sessions where id=$1 limit 1',[session_id]);
    const sidStore = sessionRow.rows?.[0]?.store_id;
    if (sidStore) {
      try { await assertStoreOwnership(user.id, sidStore); } catch { return res.status(403).json({ error: 'forbidden' }); }
    }
    return res.status(200).json({
      qr: r.rows[0].last_qr || null,
      status: r.rows[0].status || 'pending',
      updated_at: r.rows[0].updated_at
    });
  } catch (e: any) {
    return res.status(500).json({ error: 'internal_error' });
  }
}
