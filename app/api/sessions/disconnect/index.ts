import express from 'express'
import { requireAuth } from '../../../lib/auth'
import { supabaseService } from '../../../lib/supabaseClient'

const app = express()
app.use(express.json())

app.post('*', requireAuth(), async (req, res) => {
  const { session_id } = req.body || {}
  if (!session_id) return res.status(400).json({ error: 'session_id required' })
  const sb = supabaseService()
  await sb.from('whatsapp_sessions').update({ status: 'disconnected' }).eq('id', session_id)
  return res.json({ ok: true })
})

export default app
