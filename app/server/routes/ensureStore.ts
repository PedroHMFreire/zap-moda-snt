import { supabaseService, supabaseServer } from '../../lib/supabaseClient'

// Rota idempotente para garantir existência de uma store para o usuário autenticado.
// POST /api/stores/ensure
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }
  try {
    const auth = req.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.substring(7) : ''
    if (!token) return res.status(401).json({ error: 'missing_token' })

    // Valida usuário pelo endpoint server (anon key)
    const server = supabaseServer()
    const { data: userData, error: uErr } = await server.auth.getUser(token)
    if (uErr || !userData?.user) return res.status(401).json({ error: 'invalid_token' })
    const userId = userData.user.id

    const svc = supabaseService()
    // Verifica se já existe
    const { data: existing, error: selErr } = await svc
      .from('stores')
      .select('id,name')
      .eq('owner_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (selErr) return res.status(500).json({ error: 'select_failed' })
    if (existing) return res.status(200).json({ store_id: existing.id, name: existing.name, created: false })

    // Cria store
    const { data: inserted, error: insErr } = await svc
      .from('stores')
      .insert({ owner_id: userId, name: 'Santê Loja', description: 'Criada automaticamente ensure' })
      .select('id,name')
      .maybeSingle()
    if (insErr || !inserted) return res.status(500).json({ error: 'insert_failed' })

    // Garante config whatsapp_configs
    await svc.from('whatsapp_configs').upsert({ store_id: inserted.id }).select('store_id')

    return res.status(201).json({ store_id: inserted.id, name: inserted.name, created: true })
  } catch (e) {
    return res.status(500).json({ error: 'internal_error' })
  }
}
