// app/api/health/index.ts
import { Pool } from 'pg';

let pool: Pool | null = null;
function getPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.QUEUE_DB_URL });
  return pool;
}

export default async function handler(req: any, res: any) {
  try {
    const db = getPool();
    const r = await db.query('select now() as ts');
    res.status(200).json({ ok: true, ts: r.rows[0].ts });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
