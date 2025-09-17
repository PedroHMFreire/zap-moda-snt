import { z } from 'zod'

export const sendSchema = z.object({
  session_id: z.string().uuid(),
  to: z.string().min(6).max(30),
  text: z.string().min(1).max(1000).optional(),
  media_url: z.string().url().optional(),
  store_id: z.string().uuid(),
  conversation_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional()
}).refine((v: any) => v.text || v.media_url, { message: 'text or media_url required' })

export const inboundSchema = z.object({
  store_id: z.string().uuid(),
  from: z.string(),
  wa_id: z.string().optional(),
  text: z.string().optional(),
  media_url: z.string().url().optional(),
  timestamp: z.number().optional()
})

export const sessionCreateSchema = z.object({
  store_id: z.string().uuid()
})
