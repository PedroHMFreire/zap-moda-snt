// app/api/ai/reply/index.ts
import { Pool } from 'pg';

// Pool PG simples (usa o mesmo Postgres que o pg-boss)
let pool: Pool | null = null;
function getPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.QUEUE_DB_URL });
  return pool;
}

function must<T>(v: T, name: string): T {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    throw new Error(`${name} obrigatório`);
  }
  return v;
}

const SYSTEM_PROMPT = `
Você é o "Atendente Santê": cordial, direto e profissional. Domínio de moda (tamanhos PP–GG; 36–46), tecidos, looks e combinações.
Regras:
- Não invente estoque; se faltar info (tamanho/cor/modelo), pergunte de forma educada.
- Não prometa prazos; ofereça checar frete/prazo mediante CEP.
- Fora do horário, use away_message se estiver disponível.
- Responda em no máximo 2 parágrafos + 1 CTA curto (ex.: "Posso enviar fotos?").
- Quando pedido contiver preferências (ex.: "short praiano M até R$150"), sugira 1–3 itens do catálogo, de forma objetiva.
Fallback: se contexto for insuficiente, peça dados (tamanho, estilo, orçamento) e ofereça sugestões claras.
`.trim();

async function fetchContext(db: Pool, store_id: string, conversation_id: string) {
  const r = await db.query(
    `select direction, coalesce(content,'') as content, created_at
     from messages
     where store_id=$1 and conversation_id=$2
     order by created_at desc
     limit 12`,
    [store_id, conversation_id]
  );
  return r.rows.reverse();
}

async function fetchProducts(db: Pool, store_id: string) {
  const r = await db.query(
    `select name, price, coalesce(category,'') as category, coalesce(images,'{}') as images
     from products
     where store_id=$1
     order by created_at desc
     limit 12`,
    [store_id]
  );
  return r.rows;
}

async function fetchStore(db: Pool, store_id: string) {
  const r = await db.query(
    `select s.away_message, s.business_hours
       from stores s
      where s.id=$1
      limit 1`,
    [store_id]
  );
  return r.rows[0] || {};
}

async function fetchContactPhone(db: Pool, contact_id: string) {
  const r = await db.query(
    `select coalesce(phone, wa_id) as to from contacts where id=$1`,
    [contact_id]
  );
  return r.rows?.[0]?.to || null;
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY não configurada' });
    }

    const { store_id, conversation_id, contact_id } = req.body || {};
    must(store_id, 'store_id');
    must(conversation_id, 'conversation_id');
    must(contact_id, 'contact_id');

    const db = getPool();
    const [msgs, prods, store] = await Promise.all([
      fetchContext(db, store_id, conversation_id),
      fetchProducts(db, store_id),
      fetchStore(db, store_id),
    ]);

    // prompt de usuário com contexto objetivo
    const lines: string[] = [];
    lines.push('Histórico (mais recente por último):');
    for (const m of msgs) {
      lines.push(`${m.direction === 'out' ? 'Atendente' : 'Cliente'}: ${m.content}`);
    }
    lines.push('');
    if (store?.away_message) {
      lines.push(`Mensagem de ausente configurada: "${store.away_message}"`);
      lines.push('');
    }
    lines.push('Catálogo (nome • preço • categoria):');
    for (const p of prods) {
      const price = Number(p.price || 0).toFixed(2);
      lines.push(`${p.name} • R$ ${price} • ${p.category || '-'}`);
    }
    lines.push('');
    lines.push('Gere uma resposta útil, breve (máx. 2 parágrafos) e finalize com um CTA curto.');

    const input = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: lines.join('\n') },
    ];

    // OpenAI Responses API
    const oai = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        input
      })
    });

    if (!oai.ok) {
      const text = await oai.text().catch(() => 'OpenAI error');
      throw new Error(`OpenAI: ${text}`);
    }
    const payload: any = await oai.json();
    const answer: string =
      payload?.output_text ||
      payload?.choices?.[0]?.message?.content ||
      'Posso ajudar com mais detalhes?';

    // Descobre "to" do contato
    const to = await fetchContactPhone(db, contact_id);
    if (!to) {
      // Sem telefone: retorne a resposta para exibir no painel; o operador pode enviar manualmente
      return res.status(200).json({ ok: true, answer, note: 'Contato sem phone/wa_id' });
    }

    // Reenvia via /api/send para enfileirar no Worker e registrar em messages
    const apiBase = process.env.API_BASE || '';
    await fetch(`${apiBase}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-store-id': store_id },
      body: JSON.stringify({ to, text: answer, store_id, conversation_id, contact_id })
    }).catch(() => { /* silencioso */ });

    return res.status(200).json({ ok: true, answer });
  } catch (e: any) {
    // fallback suave — não derrubar webhook upstream
    return res.status(200).json({ ok: false, error: e.message, fallback: 'Sem resposta automática no momento.' });
  }
}