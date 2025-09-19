import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Função serverless mínima para operações que precisam SERVICE_ROLE (ex: manutenção, geração IA, etc.)
// Neste estágio ignoramos segurança avançada (apenas POC). Depois: validar Authorization, checar origem, etc.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE; // opcional nesta fase
  if(!url) return res.status(500).json({ error: 'SUPABASE_URL ausente' });

  const client = service ? createClient(url, service, { auth: { persistSession: false } }) : null;

  if(req.method === 'GET') {
    return res.status(200).json({ ok:true, time: new Date().toISOString(), mode: service? 'service-role':'anon-only' });
  }

  if(req.method === 'POST') {
    // Exemplo de ação: contar quantos contatos existem (usando service role se disponível)
    if(!client) return res.status(400).json({ error: 'SERVICE_ROLE não configurada para operação' });
    const { data, error } = await client.from('contacts').select('id', { count: 'exact', head: true });
    if(error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok:true, contacts_count: data?.length, info: 'Use count em queries reais se preferir' });
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}
