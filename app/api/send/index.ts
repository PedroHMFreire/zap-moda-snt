import express from 'express'
import { sendSchema } from '../../lib/validators'
import { requireAuth, assertStoreOwnership } from '../../lib/auth'
import { enqueueSend } from '../../lib/queue'
import { supabaseService } from '../../lib/supabaseClient'
import { normalizePhone, isValidPhone } from '../../lib/phone'

const app = express()
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
    store_id: payload.store_id
  })
  return res.json({ ok: true, message_id: msg.id })
})

export default app
