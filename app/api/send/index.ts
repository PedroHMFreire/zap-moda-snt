// app/api/send/index.ts
import { Pool } from 'pg';

let pool: Pool | null = null;
function getPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.QUEUE_DB_URL });
  return pool;
}
function getStoreId(req: any) {
  return req.headers['x-store-id'] || req.query.store_id || req.body?.store_id;
}

async function ensureContactAndConversation(db: Pool, store_id: string, phoneOrWa: string) {
  // procura contato por phone ou wa_id
  let r = await db.query(
    `select id from contacts where store_id=$1 and (phone=$2 or wa_id=$2) limit 1`,
    [store_id, phoneOrWa]
  );
  let contact_id: string;
  if (r.rowCount === 0) {
    r = await db.query(
      `insert into contacts (store_id, phone, wa_id, last_interaction_at) values ($1,$2,$2, now()) returning id`,
      [store_id, phoneOrWa]
    );
  }
  contact_id = r.rows[0].id;

  // conversa aberta (ou cria)
  r = await db.query(
    `select id from conversations where store_id=$1 and contact_id=$2 and status='open' order by created_at desc limit 1`,
    [store_id, contact_id]
  );
  let conversation_id: string;
  if (r.rowCount === 0) {
    r = await db.query(
      `insert into conversations (store_id, contact_id, status, last_message_at)
       values ($1,$2,'open', now()) returning id`,
      [store_id, contact_id]
    );
  }
  conversation_id = r.rows[0].id;

  return { contact_id, conversation_id };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getPool();
  const store_id = getStoreId(req);
  if (!store_id) return res.status(400).json({ error: 'store_id obrigatório.' });

  try {
    const { to, text, media_url } = req.body || {};
    if (!to || (!text && !media_url)) {
      return res.status(400).json({ error: 'to e (text ou media_url) são obrigatórios.' });
    }

    const { contact_id, conversation_id } = await ensureContactAndConversation(db, store_id, to);

    // grava a mensagem com status 'queued'
    const m = await db.query(
      `insert into messages (conversation_id, store_id, contact_id, direction, type, content, media_url, status, created_at)
       values ($1,$2,$3,'out', $4, $5, $6, 'queued', now())
       returning id`,
      [conversation_id, store_id, contact_id, media_url ? 'media' : 'text', text || null, media_url || null]
    );
    const message_id = m.rows[0].id;

    // enfileira para o Worker (pg-boss)
    await db.query(
      `select pg_notify('boss', json_build_object('name','send:message','data', json_build_object(
          'store_id',$1,'to',$2,'text',$3,'media_url',$4,'conversation_id',$5,'contact_id',$6,'message_id',$7
        ))::text)`,
      [store_id, to, text || null, media_url || null, conversation_id, contact_id, message_id]
    );
    // Acima: uso NOTIFY como fallback simples. Se já tiver pg-boss instalado, o Worker pode escutar a fila/notify.
    // (Em produção: usar INSERT na tabela de jobs do pg-boss conforme setup do seu queue.ts.)

    return res.status(202).json({ enqueued: true, message_id, conversation_id, contact_id });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}
