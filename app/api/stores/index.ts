import express from 'express'
import { requireAuth } from '../../lib/auth'
import { supabaseService } from '../../lib/supabaseClient'

const app = express()
app.use(express.json())

app.get('*', requireAuth(), async (req, res) => {
  const store_id = (req.query.store_id as string) || ''
  const sb = supabaseService()
  if (store_id) {
    const { data, error } = await sb.from('stores').select('*, whatsapp_configs(*)').eq('id', store_id).maybeSingle()
    if (error) return res.status(500).json({ error: error.message })
    return res.json(data)
  }
  // list stores for current owner
  const user = (req as any).user
  const { data, error } = await sb.from('stores').select('id, name, created_at').eq('owner_id', user.id).order('created_at', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  return res.json(data)
})

app.post('*', requireAuth(), async (req, res) => {
  const sb = supabaseService()
  const { store, config } = req.body || {}
  const user = (req as any).user
  let storeId = store?.id as string | undefined
  if (storeId) {
    await sb.from('stores').update({ ...store, id: storeId }).eq('id', storeId)
  } else if (store?.name) {
    const { data, error } = await sb.from('stores').insert({ name: store.name, description: store.description || null, owner_id: user.id }).select('id').single()
    if (error) return res.status(500).json({ error: error.message })
    storeId = data.id
  }
  if (storeId) {
    const cfg = { store_id: storeId, channel: config?.channel || 'qr', rate_limit_per_min: config?.rate_limit_per_min ?? 20, enabled: config?.enabled ?? true }
    await sb.from('whatsapp_configs').upsert(cfg)
  }
  return res.json({ ok: true, store_id: storeId })
})

export default app
