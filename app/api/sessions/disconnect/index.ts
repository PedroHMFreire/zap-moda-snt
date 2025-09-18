// app/api/sessions/disconnect/index.ts
import { Pool } from 'pg';

let pool: Pool | null = null;
function db() {
  if (!pool) pool = new Pool({ connectionString: process.env.QUEUE_DB_URL });
  return pool!;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { session_id, store_id } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id obrigatório.' });

  try {
    const p = db();
    // marca como disconnected
    const up = await p.query(
      `update whatsapp_sessions
          set status='disconnected', last_qr=null, updated_at=now()
        where id=$1
        returning id, store_id`,
      [session_id]
    );
    if (up.rowCount === 0) return res.status(404).json({ error: 'Sessão não encontrada' });
    const sid = up.rows[0].id;
    const stid = up.rows[0].store_id || store_id;

    // notifica o worker para encerramento
    await p.query(
      `select pg_notify('boss', json_build_object('name','session:stop','data', json_build_object(
        'store_id',$1,'session_id',$2
      ))::text)`,
      [stid, sid]
    );

    return res.status(200).json({ ok: true, session_id: sid });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}
