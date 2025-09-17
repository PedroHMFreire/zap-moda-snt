import express from 'express'
import pino from 'pino'
import { inboundSchema } from '../../lib/validators'
import { verifyInternalSignature } from '../../lib/auth'
import { upsertContactByPhone, getOrCreateConversation, insertMessage } from '../../lib/db'
import { enqueueAi } from '../../lib/queue'
import { requestLogger } from '../../lib/logger'

const app = express()
app.use(requestLogger())
app.use(express.json())
const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

app.post('*', async (req, res) => {
  if (!verifyInternalSignature(req)) return res.status(401).json({ error: 'invalid signature' })
  const parse = inboundSchema.safeParse(req.body)
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() })
  const { store_id, from, text, media_url, wa_id } = parse.data
  try {
    const contact = await upsertContactByPhone(store_id, from, { wa_id })
    const conv = await getOrCreateConversation(store_id, contact.id)
    const msg = await insertMessage({
      store_id,
      contact_id: contact.id,
      conversation_id: conv.id,
      direction: 'in',
      type: media_url ? 'media' : 'text',
      content: text || null,
      media_url: media_url || null,
      status: 'received'
    })
  await enqueueAi({ store_id, conversation_id: conv.id, request_id: (req as any).request_id })
    return res.json({ ok: true, message_id: msg.id })
  } catch (e:any) {
    logger.error({ err: e }, 'inbound failed')
    return res.status(500).json({ error: 'internal' })
  }
})

export default app
