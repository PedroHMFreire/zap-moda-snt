// workers/session-node/src/sender.ts
import type PgBoss from 'pg-boss';
import type pino from 'pino';
import { Pool } from 'pg';
import { fileTypeFromBuffer } from 'file-type';
import { fetch } from 'undici';

type GetSocketFn = (ownerId: string) => any | null;

type SendMessageJob = {
  owner_id?: string; // compat
  store_id?: string; // legacy
  to: string;
  text?: string;
  media_url?: string;
  conversation_id?: string;
  contact_id?: string;
  message_id?: string;
  request_id?: string;
};

// Rate limit por loja: janela deslizante de 60s
const windowMs = 60_000;
const sentTimestamps = new Map<string, number[]>(); // owner_id -> timestamps (ms)

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureRate(_pool: Pool, owner_id: string, logger: pino.Logger) {
  const limit = 20; // valor fixo simplificado
  const now = Date.now();
  const arr = (sentTimestamps.get(owner_id) || []).filter((ts) => now - ts < windowMs);
  if (arr.length >= limit) {
    const wait = windowMs - (now - arr[0]);
    logger.info({ owner_id, wait }, 'rate-limit wait');
    await sleep(wait + 50);
  }
  arr.push(Date.now());
  sentTimestamps.set(owner_id, arr);
}

async function sendViaSocket(
  sock: any,
  to: string,
  text?: string,
  media_url?: string,
  logger?: pino.Logger,
) {
  const jid = `${to}@s.whatsapp.net`;
  if (media_url) {
    const resp = await fetch(media_url);
    if (!resp.ok) throw new Error(`download failed: ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    const ft = await fileTypeFromBuffer(buf);
    const mime = ft?.mime || 'application/octet-stream';

    if (mime.startsWith('image/')) {
      await sock.sendMessage(jid, { image: buf, mimetype: mime, caption: text || undefined });
    } else if (mime.startsWith('video/')) {
      await sock.sendMessage(jid, { video: buf, mimetype: mime, caption: text || undefined });
    } else {
      await sock.sendMessage(jid, { document: buf, mimetype: mime, fileName: 'file' });
      if (text) {
        await sock.sendMessage(jid, { text });
      }
    }
  } else {
    await sock.sendMessage(jid, { text: text || '' });
  }
}

export async function startSender(
  boss: PgBoss,
  getSocket: GetSocketFn,
  pool: Pool,
  logger: pino.Logger,
) {
  await boss.work<SendMessageJob>(
    'send:message',
    { teamSize: 1, teamConcurrency: 1 },
    async (job) => {
      const { owner_id, store_id, to, text, media_url, message_id, request_id } = job.data;
      const oid = owner_id || store_id; // legacy fallback
      if (!oid || !to) return;

      const sock = getSocket(oid);
      if (!sock) {
        logger.warn({ owner_id: oid, to, rid: request_id }, 'no active session');
        await boss.publish('send:message', job.data as any, { startAfter: 5000 });
        return;
      }

      try {
        await ensureRate(pool, oid, logger);
        await sendViaSocket(sock, to, text || undefined, media_url || undefined, logger);

        if (message_id) {
          await pool.query(`update messages set status='sent' where id=$1`, [message_id]);
        }
        logger.info({ to, rid: request_id }, 'sent ok');
        return true;
      } catch (e: any) {
  logger.error({ err: e, to, rid: request_id }, 'send failed');
        await boss.publish('send:message', job.data as any, { retryLimit: 3, retryDelay: 5000 });
        if (message_id) {
          await pool.query(`update messages set status='failed' where id=$1`, [message_id]);
        }
        return false;
      }
    },
  );
}
