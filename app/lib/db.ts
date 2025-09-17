import { supabaseService } from './supabaseClient'
import { cache } from './cache'

export type MessageInput = {
  store_id: string
  contact_id?: string | null
  conversation_id?: string | null
  direction: 'in' | 'out'
  type: string
  content?: string | null
  media_url?: string | null
  status?: string | null
  ai_json?: any
}

export async function upsertContactByPhone(store_id: string, phone: string, data: Partial<{ name: string; wa_id: string; tags: string[] }>) {
  const sb = supabaseService()
  const { data: existing } = await sb.from('contacts').select('id').eq('store_id', store_id).eq('phone', phone).maybeSingle()
  if (existing) {
    const { data: updated, error } = await sb.from('contacts').update({ ...data, last_interaction_at: new Date().toISOString() }).eq('id', existing.id).select('*').single()
    if (error) throw error
    return updated
  } else {
    const { data: inserted, error } = await sb.from('contacts').insert({ store_id, phone, ...data, last_interaction_at: new Date().toISOString() }).select('*').single()
    if (error) throw error
    return inserted
  }
}

export async function getOrCreateConversation(store_id: string, contact_id: string) {
  const sb = supabaseService()
  const { data: conv } = await sb.from('conversations').select('*').eq('store_id', store_id).eq('contact_id', contact_id).order('last_message_at', { ascending: false }).limit(1).maybeSingle()
  if (conv) return conv
  const { data: created, error } = await sb.from('conversations').insert({ store_id, contact_id, status: 'open', last_message_at: new Date().toISOString() }).select('*').single()
  if (error) throw error
  return created
}

export async function insertMessage(input: MessageInput & { conversation_id: string; contact_id: string }) {
  const sb = supabaseService()
  const { data, error } = await sb.from('messages').insert(input).select('*').single()
  if (error) throw error
  await sb.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', input.conversation_id)
  return data
}

export async function fetchConversationContext(conversation_id: string, limit = 12) {
  const sb = supabaseService()
  const { data, error } = await sb
    .from('messages')
    .select('id, direction, type, content, created_at')
    .eq('conversation_id', conversation_id)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).reverse()
}

export async function searchProducts(store_id: string, query: string, limit = 5) {
  const key = `prodsearch:${store_id}:${query}:${limit}`
  return cache.wrap(key, Number(process.env.CACHE_PRODUCT_SEARCH_TTL_MS || 30000), async () => {
    const sb = supabaseService()
    const { data, error } = await sb
      .from('products')
      .select('id, name, price, category, description, images')
      .ilike('name', `%${query}%`)
      .eq('store_id', store_id)
      .limit(limit)
    if (error) throw error
    return data ?? []
  })
}
