import 'dotenv/config'
import PgBoss from 'pg-boss'
import pino from 'pino'
import fetch from 'node-fetch'
import { createClient } from '@supabase/supabase-js'
import { getSocket } from './socketRegistry'
import { fileTypeFromBuffer } from 'file-type'

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

export async function startSender() {
  const db = process.env.QUEUE_DB_URL
  if (!db) {
    logger.warn('QUEUE_DB_URL not set; sender disabled')
    return
  }
  const boss = new PgBoss({ connectionString: db })
  await boss.start()

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!)

  // Simple in-memory token bucket per store
  const buckets = new Map<string, { tokens: number; lastRefill: number; rate: number }>()
  async function allow(store_id?: string) {
    if (!store_id) return true
    const now = Date.now()
    let b = buckets.get(store_id)
    if (!b) {
      const { data } = await supabase.from('whatsapp_configs').select('rate_limit_per_min').eq('store_id', store_id).maybeSingle()
      const rate = data?.rate_limit_per_min || 20
      b = { tokens: rate, lastRefill: now, rate }
      buckets.set(store_id, b)
    }
    const elapsed = (now - b.lastRefill) / 60000
    if (elapsed > 0) {
      b.tokens = Math.min(b.rate, b.tokens + elapsed * b.rate)
      b.lastRefill = now
    }
    if (b.tokens >= 1) {
      b.tokens -= 1
      return true
    }
    return false
  }

  // Cache sockets through a lightweight in-memory map kept in index.ts.
  // For simplicity, we will send via API trigger: the index.ts maintains sockets; here we'll just mark status.
  // In production, prefer consolidating send logic in one process where sockets live.

  await boss.work('send-message', async (job: any) => {
    const { session_id, to, text, media_url, conversation_id, store_id, message_id } = (job?.data as any) || {}
    const sock = session_id ? getSocket(session_id) : undefined
    const jid = to.includes('@') ? to : `${to.replace(/[^0-9]/g, '')}@s.whatsapp.net`
    try {
      if (!(await allow(store_id))) {
        // Requeue shortly when tokens are not available
        await boss.publish('send-message', job.data, { startAfter: 5000 })
        return true
      }
      if (!sock) throw new Error('session socket not found')
      if (text) {
        await sock.sendMessage(jid, { text })
      } else if (media_url) {
        // Baixa a mídia e envia como buffer (imagem/documento) conforme tipo
        const r = await fetch(media_url)
        if (!r.ok) throw new Error(`media download failed ${r.status}`)
        const buf = Buffer.from(await r.arrayBuffer())
        const ft = await fileTypeFromBuffer(buf)
        if (ft?.mime?.startsWith('image/')) {
          await sock.sendMessage(jid, { image: buf, caption: text || undefined })
        } else if (ft?.mime === 'application/pdf') {
          await sock.sendMessage(jid, { document: buf, mimetype: ft.mime, fileName: 'arquivo.pdf' })
        } else {
          // fallback enviar como documento genérico
          await sock.sendMessage(jid, { document: buf, mimetype: ft?.mime || 'application/octet-stream', fileName: 'arquivo' })
        }
      } else {
        throw new Error('no payload to send')
      }
      if (message_id) {
        await supabase.from('messages').update({ status: 'sent' }).eq('id', message_id)
      } else {
        await supabase.from('messages')
          .update({ status: 'sent' })
          .eq('conversation_id', conversation_id)
          .eq('content', text || media_url || null)
          .eq('direction', 'out')
      }
      return true
    } catch (e: any) {
      logger.error({ err: e, to }, 'send failed')
      // Simple retry by requeueing with delay
      try { await boss.publish('send-message', job.data, { retryLimit: 3, retryDelay: 5000 }) } catch {}
      if (message_id) {
        await supabase.from('messages').update({ status: 'failed' }).eq('id', message_id)
      } else {
        await supabase.from('messages')
          .update({ status: 'failed' })
          .eq('conversation_id', conversation_id)
          .eq('content', text || media_url || null)
          .eq('direction', 'out')
      }
      return false
    }
  })
}
