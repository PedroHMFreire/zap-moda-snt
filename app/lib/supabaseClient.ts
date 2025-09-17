import { createClient } from '@supabase/supabase-js'

export const supabaseServer = () => {
  const url = process.env.SUPABASE_URL!
  const anon = process.env.SUPABASE_ANON_KEY!
  return createClient(url, anon, { auth: { persistSession: false } })
}

export const supabaseService = () => {
  const url = process.env.SUPABASE_URL!
  const service = process.env.SUPABASE_SERVICE_ROLE!
  return createClient(url, service, { auth: { persistSession: false } })
}
