// app/api/send/index.ts
import { db } from '../../lib/db';
import { enqueueSendMessage } from '../../lib/queue';
import { hitRateLimit } from '../../lib/rateLimit';
import { getUserFromAuthHeader } from '../../lib/auth';
import { logger } from '../../lib/logger';

// store_id removido: agora modelo é 1-para-1 (owner = workspace)
// Mantemos função que lê store_id apenas para backward compat se algum client antigo enviar, mas ignoramos.
function getLegacyStoreId(_req: any) {
  return undefined;
}

// Garante contato/conversa (simples)
async function ensureContactAndConversation(p: ReturnType<typeof db>, owner_id: string, phoneOrWa: string) {
  let r = await p.query(
    `select id from contacts where owner_id=$1 and (phone=$2 or wa_id=$2) limit 1`,
    [owner_id, phoneOrWa]
  );
  if (r.rowCount === 0) {
    r = await p.query(
      `insert into contacts (owner_id, phone, wa_id, last_interaction_at)
       values ($1,$2,$2, now()) returning id`,
      [owner_id, phoneOrWa]
    );
  } else {
    await p.query(`update contacts set last_interaction_at=now() where id=$1`, [r.rows[0].id]);
  }
  const contact_id = r.rows[0].id;

  let c = await p.query(
    `select id from conversations where owner_id=$1 and contact_id=$2 and status='open'
     order by created_at desc limit 1`,
    [owner_id, contact_id]
  );
  if (c.rowCount === 0) {
    c = await p.query(
      `insert into conversations (owner_id, contact_id, status, last_message_at)
       values ($1,$2,'open', now()) returning id`,
      [owner_id, contact_id]
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

  // Authentication
  const user = await getUserFromAuthHeader(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const owner_id = user.id;
  // backward compat: ignore legacy store id if provided
  getLegacyStoreId(req);

  try {
    const p = db();
    const { to, text, media_url } = req.body || {};
    if (!to || (!text && !media_url)) {
      return res.status(400).json({ error: 'to e (text ou media_url) são obrigatórios.' });
    }

    if (text && text.length > 2000) {
      return res.status(400).json({ error: 'text muito longo (máx 2000 chars)' });
    }

    // Rate limit por owner (envio)
    try {
      const rl = await hitRateLimit(`rl:send:${owner_id}`, 60, 60); // 60 msgs / 60s
      res.setHeader('X-RateLimit-Limit', rl.limit.toString());
      res.setHeader('X-RateLimit-Remaining', rl.remaining.toString());
      res.setHeader('X-RateLimit-Reset', rl.reset.toString());
      if (!rl.allowed) return res.status(429).json({ error: 'rate limit exceeded' });
    } catch (e) {
      logger.warn({ err: (e as any)?.message }, 'rate_limit_error');
      // não bloqueia envio se rate limit falhar
    }

    const { contact_id, conversation_id } = await ensureContactAndConversation(p, owner_id, to);

    // grava mensagem como 'queued'
    const m = await p.query(
      `insert into messages (conversation_id, owner_id, contact_id, direction, type, content, media_url, status, created_at)
       values ($1,$2,$3,'out', $4, $5, $6, 'queued', now())
       returning id`,
      [conversation_id, owner_id, contact_id, media_url ? 'media' : 'text', text || null, media_url || null]
    );
    const message_id = m.rows[0].id;

    // publica job PgBoss
    await enqueueSendMessage({
      owner_id,
      to,
      text: text || null,
      media_url: media_url || null,
      conversation_id,
      contact_id,
      message_id
    });

    logger.info({ owner_id, message_id, to }, 'send_enqueued');
    return res.status(202).json({ enqueued: true, message_id, conversation_id, contact_id });
  } catch (e: any) {
    logger.error({ err: e?.message, stack: e?.stack }, 'send_error');
    return res.status(500).json({ error: 'internal_error' });
  }
}
