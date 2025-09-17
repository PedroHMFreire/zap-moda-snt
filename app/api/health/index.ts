import express from 'express'
import { requestLogger } from '../../lib/logger'

const app = express()
app.use(requestLogger())

app.get('*', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() })
})

export default app
