// app/lib/queue.ts
import PgBoss from 'pg-boss';

let boss: PgBoss | null = null;
let bossReady: Promise<PgBoss> | null = null;

async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  if (!bossReady) {
    const connectionString = process.env.QUEUE_DB_URL;
    if (!connectionString) throw new Error('QUEUE_DB_URL não definida');

    bossReady = (async () => {
      const b = new PgBoss({
        connectionString,
        // schema: 'pgboss',
        monitorStateIntervalMinutes: 10
      });
      b.on('error', (err) => {
        console.error('[pg-boss] error', err);
      });
      await b.start();
      boss = b;
      return b;
    })();
  }
  return bossReady;
}

export type JobPayload = Record<string, unknown>;

export async function publishJob(name: string, data: JobPayload) {
  const b = await getBoss();
  return b.publish(name, data as object);
}

export const enqueueSendMessage = (p: {
  store_id: string; to: string; text?: string; media_url?: string;
  conversation_id?: string; contact_id?: string; message_id?: string;
}) => publishJob('send:message', p);

export const notifySessionStart = (p: { store_id: string; session_id: string }) =>
  publishJob('session:start', p);

export const notifySessionStop = (p: { store_id: string; session_id: string }) =>
  publishJob('session:stop', p);
