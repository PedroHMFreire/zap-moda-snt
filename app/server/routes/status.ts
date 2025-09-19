// app/api/sessions/status/index.ts
import { Pool } from 'pg';
import { getUserFromAuthHeader } from '../../lib/auth';

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
      `select id, owner_id, status, last_qr, connected_at, updated_at
         from whatsapp_sessions
        where id = $1
        limit 1`,
      [session_id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Sessão não encontrada' });
    const s = r.rows[0];
    if (s.owner_id !== user.id) return res.status(403).json({ error: 'forbidden' });

    return res.status(200).json({
      session_id: s.id,
  owner_id: s.owner_id,
      status: s.status || 'pending',
      last_qr: s.last_qr || null,
      connected_at: s.connected_at,
      updated_at: s.updated_at
    });
  } catch (e: any) {
    return res.status(500).json({ error: 'internal_error' });
  }
}
