// app/api/stores/bootstrap/index.ts
import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';

const pool = new Pool({
  connectionString: process.env.QUEUE_DB_URL!,
  ssl: { rejectUnauthorized: false },
});

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.substring(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

    // Usa SERVICE_ROLE só no backend (NUNCA no client)
    const supa = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);
    const { data: uData, error: uErr } = await supa.auth.getUser(token);
    if (uErr || !uData?.user) return res.status(401).json({ error: 'Invalid token' });

    const userId = uData.user.id;

    // Verifica se já existe store do owner
    const client = await pool.connect();
    try {
      const r1 = await client.query(
        `select id, name from stores where owner_id=$1 order by created_at asc limit 1`,
        [userId]
      );
      if (r1.rowCount > 0) {
        // garante whatsapp_configs
        await client.query(
          `insert into whatsapp_configs (store_id)
           values ($1) on conflict (store_id) do nothing`,
          [r1.rows[0].id]
        );
        return res.status(200).json({ store_id: r1.rows[0].id, name: r1.rows[0].name, created: false });
      }

      // cria store
      const r2 = await client.query(
        `insert into stores (owner_id, name, description)
         values ($1, $2, $3)
         returning id, name`,
        [userId, 'Santê Moda', 'Loja de moda (auto)']
      );
      const storeId = r2.rows[0].id;

      // cria configs padrão
      await client.query(
        `insert into whatsapp_configs (store_id) values ($1)
         on conflict (store_id) do nothing`,
        [storeId]
      );

      return res.status(201).json({ store_id: storeId, name: r2.rows[0].name, created: true });
    } finally {
      client.release();
    }
  } catch (e: any) {
    return res.status(500).json({ error: 'internal_error' });
  }
}