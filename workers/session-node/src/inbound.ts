import 'dotenv/config'
import crypto from 'crypto'
import fetch from 'node-fetch'

export async function postInbound(body: any) {
  const INBOUND_URL = process.env.INBOUND_URL!
  const INBOUND_TOKEN = process.env.INBOUND_TOKEN!
  const payload = JSON.stringify(body)
  const sig = crypto.createHmac('sha256', INBOUND_TOKEN).update(payload).digest('hex')
  const r = await fetch(INBOUND_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-inbound-signature': sig },
    body: payload
  })
  if (!r.ok) throw new Error(`inbound failed ${r.status}`)
  return r.json()
}