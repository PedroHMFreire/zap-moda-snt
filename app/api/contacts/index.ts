import express from 'express'
import { requireAuth, assertStoreOwnership } from '../../lib/auth'
import { supabaseService } from '../../lib/supabaseClient'
import { requestLogger } from '../../lib/logger'

const app = express()
app.use(requestLogger())
app.use(express.json())

app.get('*', requireAuth(), async (req, res) => {
  const store_id = (req.query.store_id as string) || ''
  if (!store_id) return res.status(400).json({ error: 'store_id required' })
  try {
    await assertStoreOwnership((req as any).user.id, store_id)
  } catch {
    return res.status(403).json({ error: 'forbidden' })
  }
  const sb = supabaseService()
  const { data, error } = await sb.from('contacts').select('*').eq('store_id', store_id).order('last_interaction_at', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  return res.json({ items: data || [] })
})

export default app
