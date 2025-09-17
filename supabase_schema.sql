-- Supabase schema for Zap Moda Snt
-- Requires pgcrypto for gen_random_uuid
create extension if not exists pgcrypto;

-- Tables
create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  description text,
  business_hours jsonb default '{}'::jsonb,
  away_message text default 'Estamos fora do horário. Deixe sua mensagem e retornaremos assim que possível.',
  created_at timestamptz default now()
);

create table if not exists whatsapp_configs (
  store_id uuid primary key references stores(id) on delete cascade,
  channel text default 'qr',
  rate_limit_per_min int default 20,
  enabled boolean default true
);

create table if not exists whatsapp_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  phone text,
  status text,
  last_qr text,
  connected_at timestamptz,
  updated_at timestamptz default now()
);

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  wa_id text,
  name text,
  phone text,
  tags text[],
  last_interaction_at timestamptz
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  status text default 'open',
  last_message_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  store_id uuid not null,
  contact_id uuid,
  direction text check (direction in ('in','out')) not null,
  type text default 'text',
  content text,
  media_url text,
  status text,
  ai_json jsonb,
  created_at timestamptz default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  price numeric(12,2) not null,
  category text,
  description text,
  images text[],
  created_at timestamptz default now()
);

-- Indexes
create index if not exists idx_messages_conversation_created_desc on messages(conversation_id, created_at desc);
create index if not exists idx_messages_store_created_desc on messages(store_id, created_at desc);
create index if not exists idx_messages_contact_created_desc on messages(contact_id, created_at desc);
create index if not exists idx_contacts_store_phone on contacts(store_id, phone);
create index if not exists idx_products_store_name on products(store_id, name);
create index if not exists idx_conversations_store_lastmsg_desc on conversations(store_id, last_message_at desc);
create index if not exists idx_conversations_contact_lastmsg_desc on conversations(contact_id, last_message_at desc);
create index if not exists idx_whatsapp_sessions_store_status on whatsapp_sessions(store_id, status);
create unique index if not exists ux_contacts_store_phone_notnull on contacts(store_id, phone) where phone is not null;
create unique index if not exists ux_products_store_name on products(store_id, name);

-- Row Level Security
alter table stores enable row level security;
alter table whatsapp_configs enable row level security;
alter table whatsapp_sessions enable row level security;
alter table contacts enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table products enable row level security;

-- Policies: owners access by store_id (Postgres não suporta 'create policy if not exists')
drop policy if exists stores_owner_policy on stores;
create policy stores_owner_policy on stores
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists whatsapp_configs_owner_policy on whatsapp_configs;
create policy whatsapp_configs_owner_policy on whatsapp_configs
  for all to authenticated
  using (store_id in (select id from stores where owner_id = auth.uid()))
  with check (store_id in (select id from stores where owner_id = auth.uid()));

-- whatsapp_sessions: separar policies (Postgres não aceita listar várias ações em uma só)
drop policy if exists whatsapp_sessions_owner_policy on whatsapp_sessions; -- legado se chegou a ser criada
drop policy if exists whatsapp_sessions_owner_policy_select on whatsapp_sessions;
drop policy if exists whatsapp_sessions_owner_policy_update on whatsapp_sessions;
drop policy if exists whatsapp_sessions_owner_policy_delete on whatsapp_sessions;

create policy whatsapp_sessions_owner_policy_select on whatsapp_sessions
  for select to authenticated
  using (store_id in (select id from stores where owner_id = auth.uid()));

create policy whatsapp_sessions_owner_policy_update on whatsapp_sessions
  for update to authenticated
  using (store_id in (select id from stores where owner_id = auth.uid()));

create policy whatsapp_sessions_owner_policy_delete on whatsapp_sessions
  for delete to authenticated
  using (store_id in (select id from stores where owner_id = auth.uid()));

drop policy if exists contacts_owner_policy on contacts;
create policy contacts_owner_policy on contacts
  for all to authenticated
  using (store_id in (select id from stores where owner_id = auth.uid()))
  with check (store_id in (select id from stores where owner_id = auth.uid()));

drop policy if exists conversations_owner_policy on conversations;
create policy conversations_owner_policy on conversations
  for all to authenticated
  using (store_id in (select id from stores where owner_id = auth.uid()))
  with check (store_id in (select id from stores where owner_id = auth.uid()));

drop policy if exists messages_owner_policy on messages;
create policy messages_owner_policy on messages
  for all to authenticated
  using (store_id in (select id from stores where owner_id = auth.uid()))
  with check (store_id in (select id from stores where owner_id = auth.uid()));

drop policy if exists products_owner_policy on products;
create policy products_owner_policy on products
  for all to authenticated
  using (store_id in (select id from stores where owner_id = auth.uid()))
  with check (store_id in (select id from stores where owner_id = auth.uid()));

-- Trigger to maintain updated_at on whatsapp_sessions
create or replace function touch_whatsapp_sessions_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end; $$ language plpgsql;

create trigger whatsapp_sessions_updated_at
  before update on whatsapp_sessions
  for each row execute procedure touch_whatsapp_sessions_updated_at();

-- Optional seed
insert into stores (id, owner_id, name, description)
values (
  gen_random_uuid(),
  auth.uid(),
  'Santê Moda',
  'Loja de moda praia e casual'
)
on conflict do nothing;

-- Add three products linked to the first store (for local exec replace auth.uid())
-- This seed assumes running as the owner context; adjust as necessary.
insert into products (store_id, name, price, category, description, images)
select id, 'Short praiano M', 149.90, 'praia', 'Short leve para praia (tamanhos P-M-G).', array[]::text[] from stores limit 1;
insert into products (store_id, name, price, category, description, images)
select id, 'Camiseta básica P', 79.90, 'básicos', 'Camiseta 100% algodão, cores variadas.', array[]::text[] from stores limit 1;
insert into products (store_id, name, price, category, description, images)
select id, 'Bermuda de sarja 42', 159.90, 'casual', 'Bermuda resistente, modelagem tradicional.', array[]::text[] from stores limit 1;
