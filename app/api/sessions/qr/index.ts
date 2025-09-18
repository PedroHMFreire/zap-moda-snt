// app/api/sessions/qr/index.ts
import { Pool } from 'pg';

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
    const r = await p.query(
      `select last_qr, updated_at, status
         from whatsapp_sessions
        where id=$1
        limit 1`,
      [session_id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Sessão não encontrada' });
    return res.status(200).json({
      qr: r.rows[0].last_qr || null,
      status: r.rows[0].status || 'pending',
      updated_at: r.rows[0].updated_at
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}
