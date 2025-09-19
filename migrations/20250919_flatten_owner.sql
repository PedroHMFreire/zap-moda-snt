-- Migration: Flatten tenancy (remove stores) - 2025-09-19
-- Assumes database is empty / disposable. Destrutiva.
-- 1. Drop FKs referencing stores, then drop dependent tables or alter.

-- Safety: wrap in transaction
begin;

-- Drop trigger related to stores auto creation if exists
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.create_store_for_new_user();

-- Drop RLS dependent policies first (to avoid errors when dropping tables)
-- We'll recreate RLS minimal after adding owner_id columns

-- If tables exist, proceed.

-- Messages depends indirectly on conversations/contacts, handle columns directly.
-- We'll add owner_id to each table and drop store_id.

alter table whatsapp_sessions add column if not exists owner_id uuid; 
update whatsapp_sessions set owner_id = null; -- DB vazio assume nulls, depois set not null.

alter table contacts add column if not exists owner_id uuid; 
alter table conversations add column if not exists owner_id uuid; 
alter table messages add column if not exists owner_id uuid; 
alter table products add column if not exists owner_id uuid; 

-- Since DB vazio, podemos simplesmente drop store_id e constraints.
alter table whatsapp_sessions drop column if exists store_id;
alter table contacts drop column if exists store_id; 
alter table conversations drop column if exists store_id; 
alter table messages drop column if exists store_id; 
alter table products drop column if exists store_id; 

-- Drop tables that only make sentido com store (stores, whatsapp_configs)
drop table if exists whatsapp_configs cascade;
drop table if exists stores cascade;

-- Set NOT NULL agora que modelo é owner-based
alter table whatsapp_sessions alter column owner_id set not null;
alter table contacts alter column owner_id set not null;
alter table conversations alter column owner_id set not null;
alter table messages alter column owner_id set not null;
alter table products alter column owner_id set not null;

-- Indexes por owner para queries
create index if not exists idx_contacts_owner_phone on contacts(owner_id, phone);
create index if not exists idx_products_owner_name on products(owner_id, name);
create index if not exists idx_conversations_owner_lastmsg_desc on conversations(owner_id, last_message_at desc);
create index if not exists idx_messages_owner_created_desc on messages(owner_id, created_at desc);
create index if not exists idx_whatsapp_sessions_owner_status on whatsapp_sessions(owner_id, status);

-- RLS habilitar
alter table whatsapp_sessions enable row level security;
alter table contacts enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table products enable row level security;

-- Policies simples: user só vê seus registros
create policy if not exists whatsapp_sessions_owner_policy_select on whatsapp_sessions for select using (owner_id = auth.uid());
create policy if not exists whatsapp_sessions_owner_policy_update on whatsapp_sessions for update using (owner_id = auth.uid());
create policy if not exists whatsapp_sessions_owner_policy_delete on whatsapp_sessions for delete using (owner_id = auth.uid());
create policy if not exists contacts_owner_policy on contacts for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy if not exists conversations_owner_policy on conversations for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy if not exists messages_owner_policy on messages for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy if not exists products_owner_policy on products for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

commit;
