// app/api/ai/reply/index.ts
import { Pool } from 'pg';
import { hitRateLimit } from '../../lib/rateLimit';
import { getUserFromAuthHeader } from '../../lib/auth';

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

async function fetchContext(db: Pool, owner_id: string, conversation_id: string) {
  const r = await db.query(
    `select direction, coalesce(content,'') as content, created_at
     from messages
     where owner_id=$1 and conversation_id=$2
     order by created_at desc
     limit 12`,
    [owner_id, conversation_id]
  );
  return r.rows.reverse();
}

// Produtos / away_message removidos no modelo simplificado; podemos futuramente ligar a uma tabela simples.

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

    const { conversation_id, contact_id } = req.body || {};
    must(conversation_id, 'conversation_id');
    must(contact_id, 'contact_id');

    // Autenticação opcional - se fornecida, verifica ownership; caso contrário continua (para uso interno).
    const user = await getUserFromAuthHeader(req);
    const owner_id = user?.id || null;
    if (!owner_id) return res.status(401).json({ error: 'unauthorized' });

    // Rate limit IA por owner
    try {
      const rl = await hitRateLimit(`rl:ai:${owner_id}`, 30, 300); // 30 respostas/5min
      res.setHeader('X-RateLimit-Limit', rl.limit.toString());
      res.setHeader('X-RateLimit-Remaining', rl.remaining.toString());
      res.setHeader('X-RateLimit-Reset', rl.reset.toString());
      if (!rl.allowed) return res.status(429).json({ error: 'rate limit exceeded' });
    } catch {/* falha silenciosa não bloqueia */}

    const db = getPool();
    const msgs = await fetchContext(db, owner_id, conversation_id);

    // prompt de usuário com contexto objetivo
    const lines: string[] = [];
    lines.push('Histórico (mais recente por último):');
    for (const m of msgs) {
      lines.push(`${m.direction === 'out' ? 'Atendente' : 'Cliente'}: ${m.content}`);
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
      headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization || '' },
      body: JSON.stringify({ to, text: answer, conversation_id, contact_id })
    }).catch(() => { /* silencioso */ });

    return res.status(200).json({ ok: true, answer });
  } catch (e: any) {
    const msg = (e as any)?.message || 'ai_error';
    return res.status(500).json({ ok: false, error: 'internal_error', detail: msg ? undefined : undefined });
  }
}