// workers/session-node/src/index.ts
import 'dotenv/config';
import express from 'express';
import pino from 'pino';
import PgBoss from 'pg-boss';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, WASocket } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { Pool } from 'pg';

import { startHealth } from './health';
import { postInbound } from './inbound';
import { ensureLocalAuthDir, downloadAuthDirFromStorage, uploadAuthDirToStorage } from './sessionStore';

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

export function getSocket(storeId: string): WASocket | null {
  return sessions.get(storeId)?.sock || null;
}

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

function jidToPhone(jid: string): string {
  return (jid || '').split('@')[0];
}

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

  const authDir = ensureLocalAuthDir(sessionId);
  await downloadAuthDirFromStorage(sessionId, authDir).catch(() => {});

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({
    printQRInTerminal: false,
    auth: state,
    browser: ['Sante', 'Chrome', '1.0']
  });

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

  sock.ev.on('creds.update', async () => {
    try {
      await saveCreds();
      await uploadAuthDirToStorage(sessionId, authDir).catch(() => {});
    } catch (e) {
      logger.warn({ err: e }, 'creds.update failed');
    }
  });

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
        media_url: null,
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

// ---------- Queue (PgBoss) ----------
let boss: PgBoss | null = null;

type SessionJob = { store_id: string; session_id: string };

async function startQueue() {
  boss = new PgBoss({
    connectionString: process.env.QUEUE_DB_URL,
    monitorStateIntervalMinutes: 10
  });

  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));

  await boss.start();
  logger.info('pg-boss started');

  await boss.work<SessionJob>('session:start', async (job) => {
    const { store_id, session_id } = job.data;
    if (!store_id || !session_id) return;
    await startSession(store_id, session_id);
  });

  await boss.work<SessionJob>('session:stop', async (job) => {
    const { store_id, session_id } = job.data;
    if (!store_id) return;
    await stopSession(store_id, session_id);
  });

  const { startSender } = await import('./sender');
  await startSender(boss, getSocket, pool, logger).catch((e: any) => {
    logger.warn({ err: e }, 'sender failed to start');
  });
}

// ---------- HTTP (health/metrics
