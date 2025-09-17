import OpenAI from 'openai'
import pino from 'pino'

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

export const SYSTEM_PROMPT = `Você é o "Atendente Santê", um assistente de vendas por WhatsApp para uma loja de moda. Tom neutro, cordial e direto.

Contexto de domínio (moda):
- Tamanhos: PP, P, M, G, GG; numeração: 36–46 quando aplicável.
- Tecidos comuns (ex.: algodão, linho, sarja) e looks/combinações.
- Catálogo com nome, preço, categoria, descrição e imagens.

Regras de atendimento:
- Não invente estoque nem informações. Se faltar algo, pergunte com educação.
- Não prometa datas sem base. Se necessário, peça CEP/bairro para estimar prazos.
- Fora do horário comercial, responda com a mensagem de ausência da loja (away_message) e ofereça um retorno posterior (fila de follow-up).
- Responda de forma breve: no máximo 2 parágrafos curtos + 1 CTA (ex.: "Posso enviar fotos?").
- Se o cliente der uma faixa de preço ou tamanho (ex.: "short praiano M até R$ 150"), sugira até 3 itens que encaixem.
- Mantenha sempre um tom profissional e acolhedor.

Se não for possível responder com segurança, retorne uma mensagem de segurança padrão.
`

export type AiInput = {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  products?: Array<{ id: string; name: string; price: number; category?: string | null; description?: string | null }>
  away_message?: string | null
}

export async function generateReply(input: AiInput): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')
  const openai = new OpenAI({ apiKey })
  const safetyFallback = 'No momento não consigo responder com segurança. Posso verificar e te retorno em instantes?'

  try {
    const start = Date.now()
    const toolContext = `Produtos relevantes (máx 5):\n${(input.products||[]).map(p=>`- ${p.name} — R$ ${p.price.toFixed(2)}`).join('\n')}`
    const userWithContext = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      ...(input.away_message ? [{ role: 'system' as const, content: `Mensagem de ausência: ${input.away_message}` }] : []),
      ...input.messages,
      { role: 'system' as const, content: toolContext }
    ]

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: 220,
      messages: userWithContext
    })
    const text = resp.choices?.[0]?.message?.content?.trim()
    const dur = Date.now() - start
    logger.info({ dur_ms: dur, model: 'gpt-4o-mini', tokens_est: resp.usage?.total_tokens }, 'ai.generateReply.duration')
    return text || safetyFallback
  } catch (e:any) {
    logger.error({ err: e }, 'AI generateReply failed')
    return safetyFallback
  }
}
