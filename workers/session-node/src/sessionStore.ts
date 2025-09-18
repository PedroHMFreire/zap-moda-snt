// workers/session-node/src/sessionStore.ts
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// =========================
// Config & Supabase Client
// =========================
const bucket = process.env.SESSION_STORAGE_BUCKET || 'wa-sessions';
const supa = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE! // Worker: usar Service Role para Storage
);

// =========================
// Criptografia opcional AES-256-GCM
// Formato: ENCv1:<ivBase64>:<ciphertextBase64>:<tagBase64>
// =========================
let parsedKey: Buffer | null = null;
let keyChecked = false;
let warnedOnce = false;

function parseKey(): Buffer | null {
  if (parsedKey) return parsedKey;
  const raw = process.env.SESSION_ENCRYPTION_KEY;
  if (!raw) return null;
  try {
    // tenta base64
    let k = Buffer.from(raw, 'base64');
    if (k.length !== 32) {
      // tenta hex
      k = Buffer.from(raw, 'hex');
    }
    if (k.length !== 32) throw new Error('invalid length');
    parsedKey = k;
    return parsedKey;
  } catch {
    if (!warnedOnce) {
      console.warn('[sessionStore] SESSION_ENCRYPTION_KEY inválida; salvando em claro.');
      warnedOnce = true;
    }
    return null;
  }
}

function isEncPayload(buf: Buffer): boolean {
  return buf.toString('utf8', 0, Math.min(buf.length, 6)).startsWith('ENCv1:');
}

function encryptIfPossible(plain: Buffer): Buffer {
  const key = parseKey();
  if (!key) {
    if (!keyChecked) {
      console.warn('[sessionStore] Criptografia desativada (chave ausente/ inválida).');
      keyChecked = true;
    }
    return plain;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  const out = `ENCv1:${iv.toString('base64')}:${enc.toString('base64')}:${tag.toString('base64')}`;
  return Buffer.from(out, 'utf8');
}

function decryptIfPossible(data: ArrayBuffer | Buffer | string): Buffer {
  let buf: Buffer;
  if (typeof data === 'string') buf = Buffer.from(data, 'utf8');
  else if (data instanceof Buffer) buf = data;
  else buf = Buffer.from(data);

  if (!isEncPayload(buf)) return buf;

  const key = parseKey();
  if (!key) {
    // payload parece criptografado mas não temos chave válida → devolve bruto
    return buf;
  }
  try {
    const s = buf.toString('utf8');
    const parts = s.split(':');
    if (parts.length !== 4 || parts[0] !== 'ENCv1') return buf;
    const iv = Buffer.from(parts[1], 'base64');
    const enc = Buffer.from(parts[2], 'base64');
    const tag = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]);
  } catch {
    // se falhar, devolve bruto
    return buf;
  }
}

// =========================
// API exigida pelo Worker
// =========================

/**
 * Garante e retorna o diretório local de auth do Baileys para a sessão.
 * Ex.: ./auth/<sessionId>
 */
export function ensureLocalAuthDir(sessionId: string): string {
  const dir = path.resolve(process.cwd(), 'auth', sessionId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Baixa todos os arquivos do Storage (prefixo baileys/<sessionId>/) para o authDir local.
 * Descriptografa se estiver no formato ENCv1.
 */
export async function downloadAuthDirFromStorage(sessionId: string, authDir: string) {
  // lista os arquivos sob a "pasta" virtual baileys/<sessionId>
  const prefix = `baileys/${sessionId}`;
  const { data: items, error } = await supa.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) {
    // se a pasta não existir ainda, tudo bem
    return;
  }
  // Supabase retorna "name" dos arquivos dentro do path especificado
  for (const it of items || []) {
    if (!it || !it.name) continue;
    const key = `${prefix}/${it.name}`;
    const { data, error: derr } = await supa.storage.from(bucket).download(key);
    if (derr || !data) continue;

    // data é um Blob (em Node: polyfill ok) → para Buffer
    const ab = await data.arrayBuffer();
    const content = decryptIfPossible(ab);

    const filePath = path.join(authDir, it.name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, content);
  }
}

/**
 * Sobe todos os arquivos do authDir local para o Storage (prefixo baileys/<sessionId>/).
 * Criptografa se houver chave válida.
 */
export async function uploadAuthDirToStorage(sessionId: string, authDir: string) {
  let files: string[] = [];
  try {
    files = await fs.promises.readdir(authDir);
  } catch {
    return;
  }
  const prefix = `baileys/${sessionId}`;
  for (const name of files) {
    const filePath = path.join(authDir, name);
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) continue;

    const raw = await fs.promises.readFile(filePath);
    const enc = encryptIfPossible(raw);

    const key = `${prefix}/${name}`;
    await supa.storage.from(bucket).upload(key, enc, {
      upsert: true,
      contentType: 'application/octet-stream'
    });
  }
}
