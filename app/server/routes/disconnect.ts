// app/api/sessions/disconnect/index.ts
import { db } from '../../lib/db';
import { notifySessionStop } from '../../lib/queue';
import { getUserFromAuthHeader } from '../../lib/auth';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { session_id } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id obrigatório.' });

  try {
    const p = db();
    const user = await getUserFromAuthHeader(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const up = await p.query(
      `update whatsapp_sessions
          set status='disconnected', last_qr=null, updated_at=now()
        where id=$1
        returning id, owner_id`,
      [session_id]
    );
    if (up.rowCount === 0) return res.status(404).json({ error: 'Sessão não encontrada' });
    const sid = up.rows[0].id;
    const owner_id = up.rows[0].owner_id;
    if (owner_id !== user.id) return res.status(403).json({ error: 'forbidden' });

    // publica job PgBoss para o Worker encerrar a sessão
    await notifySessionStop({ owner_id, session_id: sid });

    return res.status(200).json({ ok: true, session_id: sid });
  } catch (e: any) {
    return res.status(500).json({ error: 'internal_error' });
  }
}
