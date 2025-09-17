import type makeWASocket from '@whiskeysockets/baileys'

const sockets = new Map<string, ReturnType<typeof makeWASocket>>()

export function setSocket(sessionId: string, sock: ReturnType<typeof makeWASocket>) {
  sockets.set(sessionId, sock)
}

export function getSocket(sessionId: string) {
  return sockets.get(sessionId)
}

export function removeSocket(sessionId: string) {
  sockets.delete(sessionId)
}
