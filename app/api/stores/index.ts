// app/api/sessions/create/index.ts
import { Pool } from 'pg';

let pool: Pool | null = null;
function db() {
  if (!pool) pool = new Pool({ connectionString: process.env.QUEUE_DB_URL });
  return pool!;
}

function getStoreId(req: any) {
  return req.headers['x-store-id'] || req.query.store_id || req.body?.store_id;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const store_id = getStoreId(req);
  if (!store_id) return res.status(400).json({ error: 'store_id obrigatório (header x-store-id ou query/body).' });

  try {
    const p = db();
    // cria sessão pendente
    const created = await p.query(
      `insert into whatsapp_sessions (store_id, status, last_qr)
       values ($1, 'pending', null)
       returning id, status, last_qr, connected_at, updated_at`,
      [store_id]
    );
    const sess = created.rows[0];
    const session_id = sess.id;

    // dispara job para o Worker (via NOTIFY ou fila pg-boss)
    await p.query(
      `select pg_notify('boss', json_build_object('name','session:start','data', json_build_object(
        'store_id',$1,'session_id',$2
      ))::text)`,
      [store_id, session_id]
    );

    // retorna payload inicial; se o Worker já tiver gravado um QR, ele vem em last_qr
    return res.status(200).json({
      session_id,
      status: sess.status || 'pending',
      qr: sess.last_qr || null
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}
