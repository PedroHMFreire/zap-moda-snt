import express from 'express'
import { z } from 'zod'
import { requireAuth, assertStoreOwnership } from '../../../lib/auth'
import { supabaseService } from '../../../lib/supabaseClient'
import { enqueueStartSession } from '../../../lib/queue'

const app = express()
app.use(express.json())

const bodySchema = z.object({ store_id: z.string().uuid() })

app.post('*', requireAuth(), async (req, res) => {
  const parse = bodySchema.safeParse(req.body)
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() })
  const { store_id } = parse.data
  try {
    await assertStoreOwnership((req as any).user.id, store_id)
  } catch {
    return res.status(403).json({ error: 'forbidden' })
  }
  const sb = supabaseService()
  // Ensure a session row exists (status pending)
  const { data: session, error } = await sb
    .from('whatsapp_sessions')
    .select('*')
    .eq('store_id', store_id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return res.status(500).json({ error: error.message })

  let sess = session
  if (!sess) {
    const { data: created, error: e2 } = await sb.from('whatsapp_sessions').insert({ store_id, status: 'pending' }).select('*').single()
    if (e2) return res.status(500).json({ error: e2.message })
    sess = created
  }

  // Notify worker to spin up Baileys for this session
  await enqueueStartSession({ store_id, session_id: sess.id })
  // Return last_qr if any and the session_id.
  return res.json({ session_id: sess.id, status: sess.status, qr_base64: sess.last_qr || null })
})

export default app
