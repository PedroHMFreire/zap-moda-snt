// app/api/inbound/index.ts
import { Pool } from 'pg';

let pool: Pool | null = null;
function getPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.QUEUE_DB_URL });
  return pool;
}
function authOk(req: any) {
  const hdr = (req.headers['authorization'] || '').toString();
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
  return token && token === process.env.INTERNAL_WEBHOOK_TOKEN;
}

async function upsertContact(db: Pool, store_id: string, wa_or_phone: string, name?: string) {
  let r = await db.query(
    `select id from contacts where store_id=$1 and (phone=$2 or wa_id=$2) limit 1`,
    [store_id, wa_or_phone]
  );
  if (r.rowCount === 0) {
    r = await db.query(
      `insert into contacts (store_id, phone, wa_id, name, last_interaction_at)
       values ($1,$2,$2,$3, now()) returning id`,
      [store_id, wa_or_phone, name || null]
    );
  } else {
    await db.query(
      `update contacts set last_interaction_at=now(), name=coalesce($3,name) where id=$2`,
      [null, r.rows[0].id, name || null]
    );
  }
  return (r.rowCount ? r.rows[0].id : (await db.query(
    `select id from contacts where store_id=$1 and (phone=$2 or wa_id=$2) limit 1`,
    [store_id, wa_or_phone]
  )).rows[0].id);
}

async function ensureConversation(db: Pool, store_id: string, contact_id: string) {
  let r = await db.query(
    `select id from conversations where store_id=$1 and contact_id=$2 and status='open'
     order by created_at desc limit 1`,
    [store_id, contact_id]
  );
  if (r.rowCount === 0) {
    r = await db.query(
      `insert into conversations (store_id, contact_id, status, last_message_at)
       values ($1,$2,'open', now()) returning id`,
      [store_id, contact_id]
    );
  }
  return r.rows[0].id;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!authOk(req)) return res.status(401).json({ error: 'Unauthorized' });

  const db = getPool();
  try {
    const { store_id, from, name, type, content, media_url, ts } = req.body || {};
    if (!store_id || !from) return res.status(400).json({ error: 'store_id e from são obrigatórios.' });

    const contact_id = await upsertContact(db, store_id, from, name);
    const conversation_id = await ensureConversation(db, store_id, contact_id);

    await db.query(
      `insert into messages (conversation_id, store_id, contact_id, direction, type, content, media_url, status, created_at)
       values ($1,$2,$3,'in',$4,$5,$6,'received', to_timestamp($7))`,
      [conversation_id, store_id, contact_id, media_url ? 'media' : (type || 'text'), content || null, media_url || null, Math.floor(((ts ? Number(ts) : Date.now())/1000))]
    );
    await db.query(`update conversations set last_message_at=now() where id=$1`, [conversation_id]);

    // dispara IA de forma assíncrona (não bloqueia)
    fetch((process.env.API_BASE || '') + '/api/ai/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id, conversation_id, contact_id })
    }).catch(() => { /* silencioso */ });

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}
