import { z } from 'zod'

// Novo modelo: não há mais store_id. owner_id deriva do token (user.id)
export const sendSchema = z.object({
  to: z.string().min(6).max(30),
  text: z.string().min(1).max(1000).optional(),
  media_url: z.string().url().optional(),
  conversation_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional()
}).refine((v: any) => v.text || v.media_url, { message: 'text or media_url required' })

export const inboundSchema = z.object({
  from: z.string(),
  text: z.string().optional(),
  media_url: z.string().url().optional(),
  timestamp: z.number().optional()
})

export const sessionCreateSchema = z.object({})
