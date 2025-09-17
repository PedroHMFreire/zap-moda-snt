import express from 'express'
import { requireAuth } from '../../lib/auth'
import { supabaseService } from '../../lib/supabaseClient'

const app = express()
app.use(express.json())

app.get('*', requireAuth(), async (req, res) => {
  const store_id = (req.query.store_id as string) || ''
  const sb = supabaseService()
  const { data, error } = await sb.from('products').select('*').eq('store_id', store_id).order('created_at', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  return res.json({ items: data || [] })
})

app.post('*', requireAuth(), async (req, res) => {
  const sb = supabaseService()
  const { data, error } = await sb.from('products').insert(req.body).select('*').single()
  if (error) return res.status(400).json({ error: error.message })
  return res.json(data)
})

export default app
