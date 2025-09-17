import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

function getSb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!)
}

function authDir(sessionId: string) {
  return path.resolve(process.cwd(), `./.auth-${sessionId}`)
}

export async function ensureLocalAuthDir(sessionId: string) {
  const dir = authDir(sessionId)
  await fs.promises.mkdir(dir, { recursive: true })
  return dir
}

export async function downloadAuthDirFromStorage(sessionId: string) {
  const bucket = process.env.SESSION_STORAGE_BUCKET!
  if (!bucket) return
  const sb = getSb()
  const base = `baileys/${sessionId}`
  const { data: list, error } = await sb.storage.from(bucket).list(base, { limit: 100 })
  if (error || !list) return
  const dir = await ensureLocalAuthDir(sessionId)
  for (const f of list) {
    if (f.name.endsWith('/')) continue
    const key = `${base}/${f.name}`
    const { data } = await sb.storage.from(bucket).download(key)
    if (data) {
      const dest = path.join(dir, f.name)
      await fs.promises.writeFile(dest, Buffer.from(await data.arrayBuffer()))
    }
  }
}

export async function uploadAuthDirToStorage(sessionId: string) {
  const bucket = process.env.SESSION_STORAGE_BUCKET!
  if (!bucket) return
  const sb = getSb()
  const dir = authDir(sessionId)
  let files: string[] = []
  try {
    files = await fs.promises.readdir(dir)
  } catch {
    return
  }
  for (const name of files) {
    const filePath = path.join(dir, name)
    const stat = await fs.promises.stat(filePath)
    if (!stat.isFile()) continue
    const content = await fs.promises.readFile(filePath)
    const key = `baileys/${sessionId}/${name}`
    await sb.storage.from(bucket).upload(key, content, { upsert: true, contentType: 'application/octet-stream' })
  }
}
