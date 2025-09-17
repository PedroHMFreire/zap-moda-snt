import 'dotenv/config'
import express from 'express'
import pino from 'pino'
import { startSender } from './sender.ts'
import { startHealth } from './health.ts'
import PgBoss from 'pg-boss'
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys'
import { postInbound } from './inbound.ts'
import { createClient } from '@supabase/supabase-js'
import { downloadAuthDirFromStorage, uploadAuthDirToStorage, ensureLocalAuthDir } from './sessionStore.ts'
import { setSocket, removeSocket } from './socketRegistry.ts'

const app = express()
app.use(express.json())
const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

// Placeholder routes to create session; real Baileys spin-up would occur here
app.post('/sessions/create', async (req, res) => {
  logger.info({ body: req.body }, 'session create request received')
  return res.json({ ok: true })
})

const port = process.env.PORT || 3000
app.listen(port, async () => {
  logger.info(`Worker listening on :${port}`)
  startSender()
  startHealth(app)
  startSessionWorker()
})

async function startSessionWorker() {
  const db = process.env.QUEUE_DB_URL
  if (!db) {
    logger.warn('QUEUE_DB_URL not set; session worker disabled')
    return
  }
  const boss = new PgBoss({ connectionString: db })
  await boss.start()

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!)

  const sockets = new Map<string, ReturnType<typeof makeWASocket>>()

  await boss.work('start-session', async (job: any) => {
    const { store_id, session_id } = (job?.data as any) || {}
    logger.info({ store_id, session_id }, 'starting session')

    await ensureLocalAuthDir(session_id)
    await downloadAuthDirFromStorage(session_id)
    const { state, saveCreds } = await useMultiFileAuthState(`./.auth-${session_id}`)
  const sock = makeWASocket({ auth: state, printQRInTerminal: false })
  sockets.set(session_id, sock)
  setSocket(session_id, sock)

    sock.ev.on('connection.update', async (update) => {
      const { qr, connection, lastDisconnect } = update
      if (qr) {
        // Save QR to DB to be polled by API
        await supabase.from('whatsapp_sessions').update({ last_qr: qr, status: 'pending', updated_at: new Date().toISOString() }).eq('id', session_id)
      }
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut
        logger.warn({ session_id }, 'connection closed, reconnect=' + shouldReconnect)
        removeSocket(session_id)
      } else if (connection === 'open') {
        await supabase.from('whatsapp_sessions').update({ status: 'connected', connected_at: new Date().toISOString(), last_qr: null }).eq('id', session_id)
      }
    })

    sock.ev.on('creds.update', async () => {
      await saveCreds()
      await uploadAuthDirToStorage(session_id)
    })

    sock.ev.on('messages.upsert', async (m) => {
      for (const msg of m.messages) {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text
  const from = (msg.key.remoteJid?.split('@')[0] || '').replace(/[^0-9]/g, '')
        if (!text || !from) continue
        await postInbound({ store_id, from, text })
      }
    })
  })
}
