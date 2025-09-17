import PgBoss from 'pg-boss'

let boss: PgBoss | null = null

export function getBoss() {
  if (boss) return boss
  const db = process.env.QUEUE_DB_URL
  if (!db) throw new Error('QUEUE_DB_URL not set')
  boss = new PgBoss({ connectionString: db, application_name: 'zap-moda-snt' })
  return boss
}

export const QUEUE_SEND = 'send-message'
export const QUEUE_AI_REPLY = 'ai-reply'
export const QUEUE_START_SESSION = 'start-session'

export async function ensureBoss() {
  const b = getBoss()
  // PgBoss automatically creates queues when you publish jobs, so explicit creation is not needed.
  if (!b['__started']) {
    await b.start()
    ;(b as any)['__started'] = true
  }
  return b
}

export type SendJob = {
  session_id: string
  to: string
  text?: string
  media_url?: string
  store_id: string
  conversation_id?: string
  contact_id?: string
  message_id?: string
  request_id?: string
}

export async function enqueueSend(job: SendJob) {
  const b = await ensureBoss()
  await b.publish(QUEUE_SEND, job)
}

export type AiReplyJob = {
  store_id: string
  conversation_id: string
  request_id?: string
}

export async function enqueueAi(job: AiReplyJob) {
  const b = await ensureBoss()
  await b.publish(QUEUE_AI_REPLY, job)
}

export type StartSessionJob = {
  store_id: string
  session_id: string
  request_id?: string
}

export async function enqueueStartSession(job: StartSessionJob) {
  const b = await ensureBoss()
  await b.publish(QUEUE_START_SESSION, job)
}
