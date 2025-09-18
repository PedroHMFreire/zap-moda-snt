// app/api/sessions/create/index.ts
import { db } from '../../../lib/db';
import { notifySessionStart } from '../../../lib/queue';

function getStoreId(req: any) {
  return req.headers['x-store-id'] || req.query.store_id || req.body?.store_id;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const store_id = getStoreId(req);
  if (!store_id) return res.status(400).json({ error: 'store_id obrigatório.' });

  try {
    const p = db();
    const created = await p.query(
      `insert into whatsapp_sessions (store_id, status, last_qr)
       values ($1, 'pending', null)
       returning id, status, last_qr, connected_at, updated_at`,
      [store_id]
    );
    const sess = created.rows[0];
    const session_id = sess.id;

    // publica job PgBoss para o Worker iniciar a sessão
    await notifySessionStart({ store_id, session_id });

    return res.status(200).json({
      session_id,
      status: sess.status || 'pending',
      qr: sess.last_qr || null
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}
