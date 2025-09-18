// app/lib/db.ts
import { Pool } from 'pg';

let pool: Pool | null = null;

export function db() {
  if (!pool) {
    const connectionString = process.env.QUEUE_DB_URL;
    if (!connectionString) throw new Error('QUEUE_DB_URL não definida');
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false } // Supabase/hosts gerenciados
    });
  }
  return pool;
}

export async function q<T = any>(sql: string, params?: any[]) {
  const r = await db().query(sql, params);
  return r.rows as T[];
}
