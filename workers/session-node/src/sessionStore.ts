import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// Encryption format: ENCv1:<ivBase64>:<ciphertextBase64>:<tagBase64>
// Key must be 32 bytes (base64 or hex env acceptable). If missing/invalid we log once and store plaintext.

let encryptionConfigured: boolean | null = null
let parsedKey: Buffer | null = null
let warned = false

function parseKey(): Buffer | null {
  if (parsedKey) return parsedKey
  const raw = process.env.SESSION_ENCRYPTION_KEY
  if (!raw) return null
  try {
    if (/^[A-Fa-f0-9]{64}$/.test(raw)) {
      parsedKey = Buffer.from(raw, 'hex')
    } else {
      parsedKey = Buffer.from(raw, 'base64')
    }
    if (parsedKey.length !== 32) {
      parsedKey = null
      return null
    }
    return parsedKey
  } catch {
    return null
  }
}

function ensureKey(): Buffer | null {
  if (encryptionConfigured === null) {
    const k = parseKey()
    encryptionConfigured = !!k
    if (!k && !warned) {
      console.warn('[sessionStore] SESSION_ENCRYPTION_KEY ausente ou inválida – armazenando credenciais em texto simples.')
      warned = true
    } else if (k && !warned) {
      console.log('[sessionStore] Criptografia de sessão habilitada (ENCv1).')
      warned = true
    }
  }
  return parsedKey
}

function encryptIfPossible(buf: Buffer): Buffer {
  const key = ensureKey()
  if (!key) return buf
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(buf), cipher.final()])
  const tag = cipher.getAuthTag()
  const out = `ENCv1:${iv.toString('base64')}:${ciphertext.toString('base64')}:${tag.toString('base64')}`
  return Buffer.from(out)
}

function tryDecrypt(buf: Buffer): Buffer {
  const key = ensureKey()
  if (!key) return buf
  const txt = buf.toString('utf8')
  if (!txt.startsWith('ENCv1:')) return buf
  const parts = txt.split(':')
  if (parts.length !== 4) return buf
  try {
    const iv = Buffer.from(parts[1], 'base64')
    const data = Buffer.from(parts[2], 'base64')
    const tag = Buffer.from(parts[3], 'base64')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(data), decipher.final()])
    return plain
  } catch (e) {
    console.warn('[sessionStore] Falha ao descriptografar arquivo de sessão, retornando dado bruto.', e)
    return buf
  }
}

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
      const raw = Buffer.from(await data.arrayBuffer())
      const dec = tryDecrypt(raw)
      const dest = path.join(dir, f.name)
      await fs.promises.writeFile(dest, dec)
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
    const enc = encryptIfPossible(content)
    const key = `baileys/${sessionId}/${name}`
    await sb.storage.from(bucket).upload(key, enc, { upsert: true, contentType: 'application/octet-stream' })
  }
}
