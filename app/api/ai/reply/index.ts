import express from 'express'
import { fetchConversationContext, searchProducts } from '../../../lib/db'
import { generateReply } from '../../../lib/ai'
import { enqueueSend } from '../../../lib/queue'
import { supabaseService } from '../../../lib/supabaseClient'

const app = express()
app.use(express.json())

app.post('*', async (req, res) => {
  const { store_id, conversation_id, session_id, to } = req.body || {}
  if (!store_id || !conversation_id) return res.status(400).json({ error: 'store_id and conversation_id required' })

  const sb = supabaseService()
  const { data: store } = await sb.from('stores').select('away_message').eq('id', store_id).maybeSingle()

  const msgs = await fetchConversationContext(conversation_id)
  const lastUser = msgs.filter(m => m.direction === 'in').slice(-1)[0]
  const query = lastUser?.content || ''
  const products = query ? await searchProducts(store_id, query) : []

  const reply = await generateReply({
    messages: msgs.map(m => ({ role: m.direction === 'in' ? 'user' : 'assistant', content: m.content || '' })),
    products: products.map(p => ({ id: p.id, name: p.name, price: Number(p.price), category: p.category || undefined, description: p.description || undefined })),
    away_message: store?.away_message || undefined
  })

  if (session_id && to) {
    await enqueueSend({ session_id, to, text: reply, store_id, conversation_id })
  }

  return res.json({ ok: true, reply })
})

export default app
