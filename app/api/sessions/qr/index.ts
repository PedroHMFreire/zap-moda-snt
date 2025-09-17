import express from 'express'
import { supabaseService } from '../../../lib/supabaseClient'
import QRCode from 'qrcode'

const app = express()

app.get('*', async (req, res) => {
  const session_id = (req.query.session_id as string) || ''
  if (!session_id) return res.status(400).json({ error: 'session_id required' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  let lastQR: string | null = null
  const sb = supabaseService()
  const interval = setInterval(async () => {
    try {
      const { data } = await sb.from('whatsapp_sessions').select('last_qr, status').eq('id', session_id).maybeSingle()
      if (!data) return
      if (data.last_qr && data.last_qr !== lastQR) {
        lastQR = data.last_qr
        // Convert QR text into PNG data URL and send only base64 part
        try {
          const dataUrl = await QRCode.toDataURL(lastQR, { margin: 1, width: 256 })
          const base64 = (dataUrl.split(',')[1]) || ''
          res.write(`event: qr\n`)
          res.write(`data: ${JSON.stringify({ qr_base64: base64 })}\n\n`)
        } catch {}
      }
      if (data.status === 'connected') {
        res.write(`event: connected\n`)
        res.write(`data: {}\n\n`)
      }
    } catch {}
  }, 1000)

  req.on('close', () => {
    clearInterval(interval)
  })
})

export default app
