import express from 'express'
import { sendSchema } from '../../lib/validators'
import { requireAuth, assertStoreOwnership } from '../../lib/auth'
import { enqueueSend } from '../../lib/queue'
import { supabaseService } from '../../lib/supabaseClient'
import { normalizePhone, isValidPhone } from '../../lib/phone'
import { hitRateLimit } from '../../lib/rateLimit'
import { requestLogger } from '../../lib/logger'
import { cache } from '../../lib/cache'

const app = express()
app.use(requestLogger())
app.use(express.json())

app.post('*', requireAuth(), async (req, res) => {
  const parse = sendSchema.safeParse(req.body)
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() })
  const payload = parse.data
  try {
    await assertStoreOwnership((req as any).user.id, payload.store_id)
  } catch {
    return res.status(403).json({ error: 'forbidden' })
  }
  // Rate limit (per store) using configured limit in whatsapp_configs (cached)
  try {
    const key = `whatsapp_cfg:${payload.store_id}`
    const cfg = await cache.wrap<{ rate_limit_per_min?: number } | null>(key, undefined, async () => {
      const sb = supabaseService()
      const { data } = await sb.from('whatsapp_configs').select('rate_limit_per_min').eq('store_id', payload.store_id).maybeSingle()
      return data || null
    })
    const limit = cfg?.rate_limit_per_min || 20
    const rl = await hitRateLimit(`send:${payload.store_id}`, limit, 60)
    if (!rl.allowed) {
      return res.status(429).json({ error: 'rate_limited', limit, retry_at: rl.reset })
    }
  } catch (e:any) {
    // Fail-closed to prevent abuse if we cannot validate limits
    return res.status(503).json({ error: 'rate_limit_unavailable', detail: e.message })
  }
  // create message row now (single writer) to track status
  const sb = supabaseService()
  const { data: msg, error } = await sb.from('messages').insert({
    store_id: payload.store_id,
    contact_id: payload.contact_id || null,
    conversation_id: payload.conversation_id || null,
    direction: 'out',
    type: payload.media_url ? 'media' : 'text',
    content: payload.text || payload.media_url || null,
    media_url: payload.media_url || null,
    status: 'queued'
  }).select('id').single()
  if (error) return res.status(500).json({ error: error.message })
  const normTo = normalizePhone(payload.to)
  if (!isValidPhone(normTo)) return res.status(400).json({ error: 'invalid phone number' })
  await enqueueSend({
    ...payload,
    message_id: msg.id,
    session_id: payload.session_id,
    to: normTo,
    store_id: payload.store_id,
    request_id: (req as any).request_id
  })
  return res.json({ ok: true, message_id: msg.id })
})

export default app
