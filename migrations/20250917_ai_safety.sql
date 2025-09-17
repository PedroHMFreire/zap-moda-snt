-- AI safety / loop prevention columns - 2025-09-17
alter table conversations add column if not exists last_ai_reply_at timestamptz;
alter table conversations add column if not exists last_ai_reply_hash text;
alter table conversations add column if not exists last_inbound_hash text;

-- optional index for time-based queries
create index if not exists idx_conversations_last_ai_reply_at on conversations(last_ai_reply_at desc);
