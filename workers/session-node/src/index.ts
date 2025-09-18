import 'dotenv/config';
import express from 'express';
import pino from 'pino';
import PgBoss from 'pg-boss';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, WASocket } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { Pool } from 'pg';
import { startHealth } from './health'; // expõe /health e /metrics
import { postInbound } from './inbound'; // POST → /api/inbound (Vercel) com INBOUND_TOKEN
import { ensureLocalAuthDir, downloadAuthDirFromStorage, uploadAuthDirToStorage } from './sessionStore';

// --------- Config & Globals ----------
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const PORT = Number(process.env.PORT || 3000);
const MAX = Number(process.env.MAX_SESSIONS_PER_NODE || 50);

if (!process.env.QUEUE_DB_URL) {
  logger.error('QUEUE_DB_URL não definida');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.QUEUE_DB_URL,
  ssl: { rejectUnauthorized: false }
});

type Session = { sessionId: string; storeId: string; sock: WASocket; authDir: string };
const sessions = new Map<string, Session>(); // chave: storeId

// --------- Helpers DB ----------
async function dbQuery<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

async function setQR(sessionId: string, qrDataUrl: string) {
  await dbQuery(
    `update whatsapp_sessions set last_qr=$2, status='pending', updated_at=now() where id=$1`,
    [sessionId, qrDataUrl]
  ).catch(e => logger.warn({ err: e }, 'setQR failed'));
}

async function setConnected(sessionId: string) {
  await dbQuery(
    `update whatsapp_sessions set status='connected', connected_at=now(), updated_at=now() where id=$1`,
    [sessionId]
  ).catch(e => logger.warn({ err: e }, 'setConnected failed'));
}

async function setFailed(sessionId: string) {
  await dbQuery(
    `update whatsapp_sessions set status='failed', updated_at=now() where id=$1`,
    [sessionId]
  ).catch(e => logger.warn({ err: e }, 'setFailed failed'));
}

async function setDisconnected(sessionId: string) {
  await dbQuery(
    `update whatsapp_sessions set status='disconnected', last_qr=null, updated_at=now() where id=$1`,
    [sessionId]
  ).catch(e => logger.warn({ err: e }, 'setDisconnected failed'));
}

// --------- Utils ----------
function jidToPhone(jid: string): string {
  return (jid || '').split('@')[0]; // "5511999999999@s.whatsapp.net" → "5511999999999"
}

// --------- Baileys Session Lifecycle ----------
async function startSession(storeId: string, sessionId: string) {
  if (sessions.has(storeId)) {
    logger.info({ storeId }, 'session already running');
    return;
  }
  if (sessions.size >= MAX) {
    logger.warn({ storeId }, 'max sessions reached');
    return;
  }

  logger.info({ storeId, sessionId }, 'starting session');

  // Diretório local de auth e hidratação do estado salvo (Supabase Storage)
  const authDir = await ensureLocalAuthDir(sessionId); // ex.: ./auth/<sessionId>
  await downloadAuthDirFromStorage(sessionId).catch(() => {});

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({
    printQRInTerminal: false,
    auth: state,
    browser: ['Sante', 'Chrome', '1.0']
  });

  // Eventos de conexão
  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      try {
        const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
        await setQR(sessionId, dataUrl);
      } catch (e) {
        logger.warn({ err: e }, 'QR generation failed');
      }
    }

    if (connection === 'open') {
      sessions.set(storeId, { storeId, sessionId, sock, authDir });
      await setConnected(sessionId);
      logger.info({ storeId }, 'connected');
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error as any)?.output?.statusCode || (lastDisconnect?.error as any)?.code;
      logger.warn({ storeId, code }, 'connection closed');

      if (code === DisconnectReason.loggedOut || code === 401) {
        await setFailed(sessionId);
      } else {
        await setDisconnected(sessionId);
      }
      sessions.delete(storeId);
    }
  });

  // Persistência de credenciais
  sock.ev.on('creds.update', async () => {
    try {
      await saveCreds();
      await uploadAuthDirToStorage(sessionId).catch(() => {});
    } catch (e) {
      logger.warn({ err: e }, 'creds.update failed');
    }
  });

  // Inbound → repassa para /api/inbound
  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages?.[0];
      if (!msg?.key?.remoteJid) return;
      const from = jidToPhone(msg.key.remoteJid);
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        '';

      const hasMedia = !!(msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.documentMessage);

      await postInbound({
        store_id: storeId,
        from,
        name: null,
        type: hasMedia ? 'media' : 'text',
        content: hasMedia ? null : text,
        media_url: null, // TODO: baixar mídia e subir no Storage; preencher URL aqui
        ts: Date.now()
      });
    } catch (e) {
      logger.warn({ err: e }, 'messages.upsert handler failed');
    }
  });
}

async function stopSession(storeId: string, sessionId?: string) {
  const s = sessions.get(storeId);
  if (!s) { logger.info({ storeId }, 'no active session to stop'); return; }
  try {
    await s.sock.logout().catch(() => {});
    await setDisconnected(sessionId || s.sessionId);
    sessions.delete(storeId);
    logger.info({ storeId, sessionId: sessionId || s.sessionId }, 'stopped');
  } catch (e) {
    logger.warn({ err: e }, 'stopSession failed');
  }
}

// --------- Queue (PgBoss) ----------
let boss: PgBoss | null = null;

async function startQueue() {
  boss = new PgBoss({
    connectionString: process.env.QUEUE_DB_URL,
    // schema: 'pgboss', // se você usa schema custom, descomente
    monitorStateIntervalMinutes: 10
  });

  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));

  await boss.start();
  logger.info('pg-boss started');

  // Worker de start/stop de sessão
  await boss.work('session:start', async (job: { data: { store_id?: string; session_id?: string } }) => {
    try {
      const { store_id, session_id } = job.data || {};
      if (!store_id || !session_id) return;
      await startSession(store_id, session_id);
    } catch (e) {
      logger.error({ err: e }, 'session:start failed');
      throw e;
    }
  });

  await boss.work('session:stop', async (job: { data: { store_id?: string; session_id?: string } }) => {
    try {
      const { store_id, session_id } = job.data || {};
      if (!store_id) return;
      await stopSession(store_id, session_id);
    } catch (e) {
      logger.error({ err: e }, 'session:stop failed');
      throw e;
    }
  });

  // Opcional: se você tiver um sender dedicado para 'send:message', inicialize aqui
  // (Para simplificar, o envio pode ser implementado em um arquivo sender.ts separado.)
  try {
    const { startSender } = await import('./sender').catch(() => ({ startSender: null as any }));
    if (startSender) {
      await startSender(boss);
      logger.info('sender worker started');
    } else {
      logger.info('sender not present; skipping send:message worker');
    }
  } catch (e) {
    logger.warn({ err: e }, 'startSender unavailable/failed — continuing without it');
  }
}

// --------- HTTP (health/metrics) ----------
const app = express();
app.use(express.json());

startHealth(app, {
  getSessionsActive: () => sessions.size,
  getSendBacklog: async () => 0 // se quiser medir backlog real, posso te mandar snippet com pg-boss
});

app.listen(PORT, () => logger.info({ port: PORT }, 'worker listening'));

// --------- Boot ----------
async function boot() {
  try {
    await startQueue();
  } catch (e) {
    logger.error({ err: e }, 'Queue failed to start'); // processo continua p/ health/debug
  }
}
boot().catch((e) => {
  logger.error({ err: e }, 'boot error');
  process.exit(1);
});

// --------- Graceful Shutdown ----------
let shuttingDown = false;
async function gracefulShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Graceful shutdown initiated');

  try {
    if (boss) await boss.stop({ timeout: 5000 });
  } catch (e: any) {
    logger.warn({ err: e }, 'error stopping boss');
  }

  // Desconecta sessões (Baileys) — creds já foram persistidas em creds.update
  for (const [storeId, s] of sessions) {
    try { await s.sock.logout().catch(() => {}); } catch {}
    sessions.delete(storeId);
  }

  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
