// app/api/send/index.ts
import { db } from '../../lib/db';
import { enqueueSendMessage } from '../../lib/queue';

function getStoreId(req: any) {
  return req.headers['x-store-id'] || req.query.store_id || req.body?.store_id;
}

// Garante contato/conversa (simples)
async function ensureContactAndConversation(p: ReturnType<typeof db>, store_id: string, phoneOrWa: string) {
  let r = await p.query(
    `select id from contacts where store_id=$1 and (phone=$2 or wa_id=$2) limit 1`,
    [store_id, phoneOrWa]
  );
  if (r.rowCount === 0) {
    r = await p.query(
      `insert into contacts (store_id, phone, wa_id, last_interaction_at)
       values ($1,$2,$2, now()) returning id`,
      [store_id, phoneOrWa]
    );
  } else {
    await p.query(`update contacts set last_interaction_at=now() where id=$1`, [r.rows[0].id]);
  }
  const contact_id = r.rows[0].id;

  let c = await p.query(
    `select id from conversations where store_id=$1 and contact_id=$2 and status='open'
     order by created_at desc limit 1`,
    [store_id, contact_id]
  );
  if (c.rowCount === 0) {
    c = await p.query(
      `insert into conversations (store_id, contact_id, status, last_message_at)
       values ($1,$2,'open', now()) returning id`,
      [store_id, contact_id]
    );
  }
  const conversation_id = c.rows[0].id;

  return { contact_id, conversation_id };
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
    const { to, text, media_url } = req.body || {};
    if (!to || (!text && !media_url)) {
      return res.status(400).json({ error: 'to e (text ou media_url) são obrigatórios.' });
    }

    const { contact_id, conversation_id } = await ensureContactAndConversation(p, store_id, to);

    // grava mensagem como 'queued'
    const m = await p.query(
      `insert into messages (conversation_id, store_id, contact_id, direction, type, content, media_url, status, created_at)
       values ($1,$2,$3,'out', $4, $5, $6, 'queued', now())
       returning id`,
      [conversation_id, store_id, contact_id, media_url ? 'media' : 'text', text || null, media_url || null]
    );
    const message_id = m.rows[0].id;

    // publica job PgBoss
    await enqueueSendMessage({
      store_id,
      to,
      text: text || null,
      media_url: media_url || null,
      conversation_id,
      contact_id,
      message_id
    });

    return res.status(202).json({ enqueued: true, message_id, conversation_id, contact_id });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}
