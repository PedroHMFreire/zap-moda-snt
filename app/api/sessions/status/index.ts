import express from 'express'
import { supabaseService } from '../../../lib/supabaseClient'

const app = express()
app.use(express.json())

app.get('*', async (req, res) => {
  const session_id = (req.query.session_id as string) || ''
  if (!session_id) return res.status(400).json({ error: 'session_id required' })
  const sb = supabaseService()
  const { data, error } = await sb.from('whatsapp_sessions').select('status, connected_at, updated_at').eq('id', session_id).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!data) return res.status(404).json({ error: 'not found' })
  return res.json({ status: data.status || 'pending', connected_at: data.connected_at, updated_at: data.updated_at })
})

export default app
