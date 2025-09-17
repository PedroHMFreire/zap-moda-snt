import 'dotenv/config'
import express from 'express'
import pino from 'pino'
import { startSender } from './sender'
import { startHealth } from './health'
import PgBoss from 'pg-boss'
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys'
import { postInbound } from './inbound'
import { createClient } from '@supabase/supabase-js'
import { downloadAuthDirFromStorage, uploadAuthDirToStorage, ensureLocalAuthDir } from './sessionStore'
import { setSocket, removeSocket } from './socketRegistry'
import { normalizePhone } from '../../../app/lib/phone'

const app = express()
app.use(express.json())
const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

// No public session creation endpoint here (handled via queue + API). Intentionally removed.

const port = process.env.PORT || 3000
app.listen(port, async () => {
  logger.info(`Worker listening on :${port}`)
  startSender()
  startHealth(app)
  startSessionWorker()
})

let shuttingDown = false
let boss: PgBoss | null = null

async function startSessionWorker() {
  const db = process.env.QUEUE_DB_URL
  if (!db) {
    logger.warn('QUEUE_DB_URL not set; session worker disabled')
    return
  }
  boss = new PgBoss({ connectionString: db })
  await boss.start()

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!)

  const sockets = new Map<string, ReturnType<typeof makeWASocket>>()

  async function startWhatsAppSession(store_id: string, session_id: string, attempt = 1) {
    if (shuttingDown) return
    const tag = { store_id, session_id, attempt }
    try {
      await ensureLocalAuthDir(session_id)
      await downloadAuthDirFromStorage(session_id)
      const { state, saveCreds } = await useMultiFileAuthState(`./.auth-${session_id}`)
      const sock = makeWASocket({ auth: state, printQRInTerminal: false })
      sockets.set(session_id, sock)
      setSocket(session_id, sock)

      sock.ev.on('connection.update', async (update) => {
        const { qr, connection, lastDisconnect } = update
        if (qr) {
          await supabase.from('whatsapp_sessions').update({ last_qr: qr, status: 'pending', updated_at: new Date().toISOString() }).eq('id', session_id)
        }
        if (connection === 'close') {
          const discError = (lastDisconnect?.error as any)
          const code = discError?.output?.statusCode
          const loggedOut = code === DisconnectReason.loggedOut
            || discError?.message?.includes('logged out')
          removeSocket(session_id)
          sockets.delete(session_id)
          if (loggedOut) {
            logger.warn({ ...tag }, 'session logged out - not reconnecting')
            await supabase.from('whatsapp_sessions').update({ status: 'logged_out', updated_at: new Date().toISOString() }).eq('id', session_id)
          } else if (!shuttingDown) {
            const nextAttempt = attempt + 1
            const delay = Math.min(30_000, 1000 * Math.pow(2, attempt))
            logger.warn({ ...tag, delay }, 'connection closed - scheduling reconnect')
            setTimeout(() => startWhatsAppSession(store_id, session_id, nextAttempt).catch(e => logger.error({ ...tag, err: e }, 'reconnect failed')), delay)
          }
        } else if (connection === 'open') {
          await supabase.from('whatsapp_sessions').update({ status: 'connected', connected_at: new Date().toISOString(), last_qr: null }).eq('id', session_id)
          logger.info({ ...tag }, 'session connected')
        }
      })

      sock.ev.on('creds.update', async () => {
        await saveCreds()
        await uploadAuthDirToStorage(session_id)
      })

      sock.ev.on('messages.upsert', async (m) => {
        for (const msg of m.messages) {
          const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text
          const rawFrom = (msg.key.remoteJid?.split('@')[0] || '')
          const cleanedDigits = rawFrom.replace(/[^0-9]/g, '')
          const from = normalizePhone(cleanedDigits)
          if (!text || !from) continue
          await postInbound({ store_id, from, text })
        }
      })
    } catch (e: any) {
      logger.error({ ...tag, err: e }, 'failed to start session worker')
      if (!shuttingDown) {
        const nextAttempt = attempt + 1
        const delay = Math.min(30_000, 1000 * Math.pow(2, attempt))
        setTimeout(() => startWhatsAppSession(store_id, session_id, nextAttempt).catch(err => logger.error({ ...tag, err }, 'reconnect failure')), delay)
      }
    }
  }

  await boss.work('start-session', async (job: any) => {
    const { store_id, session_id } = (job?.data as any) || {}
    logger.info({ store_id, session_id }, 'queue start-session received')
    startWhatsAppSession(store_id, session_id).catch(e => logger.error({ store_id, session_id, err: e }, 'initial start failed'))
  })
}

async function gracefulShutdown() {
  if (shuttingDown) return
  shuttingDown = true
  logger.info('Graceful shutdown initiated')
  try {
    if (boss) await boss.stop({ timeout: 5000 })
  } catch (e:any) {
    logger.warn({ err: e }, 'error stopping boss')
  }
  // Baileys sockets will be GC'd; creds persisted via creds.update already.
  setTimeout(() => process.exit(0), 3000)
}

process.on('SIGINT', gracefulShutdown)
process.on('SIGTERM', gracefulShutdown)
