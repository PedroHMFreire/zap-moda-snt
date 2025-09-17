import pino from 'pino'
import { randomUUID } from 'crypto'
import type { Request, Response, NextFunction } from 'express'

export const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

export function requestLogger() {
  return function (req: Request, res: Response, next: NextFunction) {
    const start = Date.now()
    const rid = (req.headers['x-request-id'] as string) || randomUUID()
    ;(req as any).request_id = rid
    res.setHeader('x-request-id', rid)
    logger.info({ rid, method: req.method, path: req.path }, 'request:start')
    res.on('finish', () => {
      const ms = Date.now() - start
      logger.info({ rid, status: res.statusCode, ms }, 'request:finish')
    })
    next()
  }
}

export function withChild(rid?: string) {
  return rid ? logger.child({ rid }) : logger
}
