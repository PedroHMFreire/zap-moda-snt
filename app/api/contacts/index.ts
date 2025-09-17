import express from 'express'
import { requireAuth } from '../../lib/auth'
import { supabaseService } from '../../lib/supabaseClient'

const app = express()
app.use(express.json())

app.get('*', requireAuth(), async (req, res) => {
  const store_id = (req.query.store_id as string) || ''
  const sb = supabaseService()
  const { data, error } = await sb.from('contacts').select('*').eq('store_id', store_id).order('last_interaction_at', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  return res.json({ items: data || [] })
})

export default app
import express from 'express'
import { requireAuth } from '../../lib/auth'
import { supabaseService } from '../../lib/supabaseClient'

const app = express()
app.use(express.json())

app.get('*', requireAuth(), async (req, res) => {
  const store_id = (req.query.store_id as string) || ''
  const sb = supabaseService()
  const { data, error } = await sb.from('contacts').select('*').eq('store_id', store_id).order('last_interaction_at', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  return res.json({ items: data || [] })
})

export default app
