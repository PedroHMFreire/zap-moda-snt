-- Migration: constraints & indexes hardening (Phase 6?) - 2025-09-17
-- Idempotent patterns (use IF NOT EXISTS / DO blocks) for safe re-run

-- 1. Unique store name per owner (optional branding uniqueness)
-- (Skip if you want duplicate names per owner)
-- alter table stores add constraint stores_owner_name_unique unique (owner_id, name);

-- 2. Ensure messages have direction limited already by check; add type default
alter table messages
  alter column type set default 'text';

-- 3. Add NOT NULL where logically required
alter table messages alter column direction set not null;
alter table messages alter column store_id set not null;

alter table contacts alter column store_id set not null;

-- 4. Add phone normalization expectation: lowercase + trimmed (can add trigger later)
-- We'll add partial unique index to prevent duplicate contacts per store by phone when phone is not null
create unique index if not exists ux_contacts_store_phone_notnull on contacts(store_id, phone) where phone is not null;

-- 5. Conversations: ensure store_id not null (already) & status default enforced
alter table conversations alter column status set default 'open';

-- 6. whatsapp_sessions: ensure one active session per store (status != 'disconnected'/'logged_out') optional
-- We'll create a partial index to find active quickly
create index if not exists idx_whatsapp_sessions_store_status on whatsapp_sessions(store_id, status);

-- 7. Messages indexes for querying inbound/outbound by contact and recency
create index if not exists idx_messages_store_created_desc on messages(store_id, created_at desc);
create index if not exists idx_messages_contact_created_desc on messages(contact_id, created_at desc);

-- 8. Basic conversation recency index already exists; add contact dimension
create index if not exists idx_conversations_contact_lastmsg_desc on conversations(contact_id, last_message_at desc);

-- 9. Product uniqueness by store + name (avoid duplicates)
create unique index if not exists ux_products_store_name on products(store_id, name);

-- 10. messages status workflow (optionally we can later enforce enumeration with another check)
-- alter table messages add constraint messages_status_check check (status in ('queued','sent','failed','delivered','read'));

-- 11. Add trigger skeleton for updated_at on whatsapp_sessions
create or replace function touch_whatsapp_sessions_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end; $$ language plpgsql;

-- Ensure idempotency if trigger already created in base schema
drop trigger if exists whatsapp_sessions_updated_at on whatsapp_sessions;

create trigger whatsapp_sessions_updated_at
  before update on whatsapp_sessions
  for each row execute procedure touch_whatsapp_sessions_updated_at();

-- 12. Future: If large volume, consider partitioning messages by month.

-- 13. Add RLS policy hardening (no change here - already set). Optionally restrict inserts to owner-owned store.
-- Example (skip if already working):
-- create policy if not exists messages_insert_policy on messages
--   for insert to authenticated with check (store_id in (select id from stores where owner_id = auth.uid()));

-- 14. Validate existing nullables: Add NOT NULL for whatsapp_configs.store_id already PK.

-- End of migration.
