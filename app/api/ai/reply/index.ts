import express from 'express'
import { fetchConversationContext, searchProducts } from '../../../lib/db'
import { generateReply } from '../../../lib/ai'
import { enqueueSend } from '../../../lib/queue'
import { supabaseService } from '../../../lib/supabaseClient'
import { requireAuth, assertStoreOwnership } from '../../../lib/auth'
import { requestLogger } from '../../../lib/logger'
import { sha256Base64 } from '../../../lib/hash'
import { supabaseService as sbService } from '../../../lib/supabaseClient'
import { cache } from '../../../lib/cache'

const app = express()
app.use(requestLogger())
app.use(express.json())

app.post('*', requireAuth(), async (req, res) => {
  const { store_id, conversation_id, session_id, to } = req.body || {}
  if (!store_id || !conversation_id) return res.status(400).json({ error: 'store_id and conversation_id required' })
  try {
    await assertStoreOwnership((req as any).user.id, store_id)
  } catch {
    return res.status(403).json({ error: 'forbidden' })
  }
  const sb = supabaseService()
  // Parallel fetch with basic caching for away_message
  const convPromise = sb.from('conversations').select('id,last_ai_reply_at,last_ai_reply_hash,last_inbound_hash').eq('id', conversation_id).maybeSingle()
  const storeAway = await cache.wrap<{ away_message?: string } | null>(`store:away:${store_id}`, undefined, async () => {
    const { data } = await sb.from('stores').select('away_message').eq('id', store_id).maybeSingle()
    return data || null
  })
  const { data: conv } = await convPromise
  if (!conv) return res.status(404).json({ error: 'conversation_not_found' })

  const msgs = await fetchConversationContext(conversation_id, 40) // raw fetch (will trim below)
  // Separate inbound/outbound to compute inbound hash of most recent inbound slice
  const inboundMessages = msgs.filter(m => m.direction === 'in')
  const lastInbound = inboundMessages.slice(-1)[0]
  const lastInboundContent = lastInbound?.content || ''
  const inboundHash = lastInboundContent ? sha256Base64(lastInboundContent) : null

  // Loop protection 1: no new inbound since last AI reply
  if (inboundHash && conv.last_inbound_hash && inboundHash === conv.last_inbound_hash) {
    return res.status(409).json({ skipped: true, reason: 'no_new_inbound' })
  }

  // Loop protection 2: minimum interval (env or default 15s)
  const minIntervalMs = Number(process.env.AI_MIN_INTERVAL_MS || 15000)
  if (conv.last_ai_reply_at) {
    const diff = Date.now() - new Date(conv.last_ai_reply_at).getTime()
    if (diff < minIntervalMs) {
      return res.status(429).json({ skipped: true, reason: 'min_interval', retry_in: minIntervalMs - diff })
    }
  }

  // Context trimming: limit messages to recent N and total char budget
  const maxMessages = Number(process.env.AI_MAX_MESSAGES || 16)
  const maxChars = Number(process.env.AI_MAX_CONTEXT_CHARS || 4000)
  const trimmed: typeof msgs = []
  let total = 0
  for (const m of msgs.slice(-maxMessages)) { // consider tail first
    const c = m.content || ''
    const len = c.length
    if (total + len > maxChars) {
      // skip oldest overflow; we keep newest first by building reversed then reversing back
      continue
    }
    trimmed.push(m)
    total += len
  }
  // Ensure chronological order
  const ordered = trimmed

  const lastUser = ordered.filter(m => m.direction === 'in').slice(-1)[0]
  const query = lastUser?.content || ''
  const products = query ? await searchProducts(store_id, query) : []

  const reply = await generateReply({
    messages: ordered.map(m => ({ role: m.direction === 'in' ? 'user' : 'assistant', content: m.content || '' })),
    products: products.map(p => ({ id: p.id, name: p.name, price: Number(p.price), category: p.category || undefined, description: p.description || undefined })),
    away_message: storeAway?.away_message || undefined
  })

  const replyHash = sha256Base64(reply)
  // Deduplicate identical AI reply (if exactly same as last)
  if (conv.last_ai_reply_hash && conv.last_ai_reply_hash === replyHash) {
    return res.status(409).json({ skipped: true, reason: 'duplicate_reply' })
  }

  await sb.from('conversations').update({
    last_ai_reply_at: new Date().toISOString(),
    last_ai_reply_hash: replyHash,
    last_inbound_hash: inboundHash
  }).eq('id', conversation_id)

  if (session_id && to) {
    await enqueueSend({ session_id, to, text: reply, store_id, conversation_id, request_id: (req as any).request_id })
  }

  return res.json({ ok: true, reply })
})

export default app
