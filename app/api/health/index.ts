import express from 'express'

const app = express()

app.get('*', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() })
})

export default app
