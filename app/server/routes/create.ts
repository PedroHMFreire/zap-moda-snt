// app/api/sessions/create/index.ts
import { db } from '../../lib/db';
import { notifySessionStart } from '../../lib/queue';
import { getUserFromAuthHeader } from '../../lib/auth';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const user = await getUserFromAuthHeader(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const owner_id = user.id;
    const p = db();
    const created = await p.query(
      `insert into whatsapp_sessions (owner_id, status, last_qr)
       values ($1, 'pending', null)
       returning id, status, last_qr, connected_at, updated_at`,
      [owner_id]
    );
    const sess = created.rows[0];
    const session_id = sess.id;

    // publica job PgBoss para o Worker iniciar a sessão
  await notifySessionStart({ owner_id, session_id });

    return res.status(200).json({
      session_id,
      status: sess.status || 'pending',
      qr: sess.last_qr || null
    });
  } catch (e: any) {
    return res.status(500).json({ error: 'internal_error' });
  }
}
