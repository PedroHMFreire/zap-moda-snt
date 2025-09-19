-- Supabase flattened schema (user = workspace)
-- Requer: pgcrypto
create extension if not exists pgcrypto;

-- Contatos
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  wa_id text,
  name text,
  phone text,
  tags text[],
  last_interaction_at timestamptz,
  created_at timestamptz default now()
);

-- Conversas
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  contact_id uuid references contacts(id) on delete set null,
  status text default 'open',
  last_message_at timestamptz,
  last_ai_reply_at timestamptz,
  last_ai_reply_hash text,
  last_inbound_hash text,
  created_at timestamptz default now()
);

-- Mensagens
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  conversation_id uuid references conversations(id) on delete cascade,
  contact_id uuid,
  direction text check (direction in ('in','out')) not null,
  type text default 'text',
  content text,
  media_url text,
  status text,
  ai_json jsonb,
  created_at timestamptz default now()
);

-- Produtos
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  price numeric(12,2) not null,
  category text,
  description text,
  images text[],
  created_at timestamptz default now()
);

-- Sessões WhatsApp
create table if not exists whatsapp_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  phone text,
  status text,
  last_qr text,
  connected_at timestamptz,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

-- Rate Limit
create table if not exists application_rate_limits (
  key text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  counter int not null default 0,
  constraint application_rate_limits_pk primary key (key, window_start)
);

-- Índices
create index if not exists idx_contacts_owner_phone on contacts(owner_id, phone);
create unique index if not exists ux_contacts_owner_phone_notnull on contacts(owner_id, phone) where phone is not null;
create index if not exists idx_conversations_owner_lastmsg_desc on conversations(owner_id, last_message_at desc);
create index if not exists idx_conversations_contact_lastmsg_desc on conversations(contact_id, last_message_at desc);
create index if not exists idx_conversations_last_ai_reply_at on conversations(last_ai_reply_at desc);
create index if not exists idx_messages_conversation_created_desc on messages(conversation_id, created_at desc);
create index if not exists idx_messages_owner_created_desc on messages(owner_id, created_at desc);
create index if not exists idx_messages_contact_created_desc on messages(contact_id, created_at desc);
create index if not exists idx_products_owner_name on products(owner_id, name);
create index if not exists idx_whatsapp_sessions_owner_status on whatsapp_sessions(owner_id, status);
create index if not exists idx_application_rate_limits_key_window_end on application_rate_limits(key, window_end);

-- Trigger updated_at
create or replace function touch_whatsapp_sessions_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end; $$ language plpgsql;
drop trigger if exists whatsapp_sessions_updated_at on whatsapp_sessions;
create trigger whatsapp_sessions_updated_at before update on whatsapp_sessions for each row execute procedure touch_whatsapp_sessions_updated_at();

-- RLS
alter table contacts enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table products enable row level security;
alter table whatsapp_sessions enable row level security;
alter table application_rate_limits enable row level security;

-- Policies (owner_id)
drop policy if exists contacts_all on contacts;
create policy contacts_all on contacts for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists conversations_all on conversations;
create policy conversations_all on conversations for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists messages_all on messages;
create policy messages_all on messages for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists products_all on products;
create policy products_all on products for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists whatsapp_sessions_select on whatsapp_sessions;
drop policy if exists whatsapp_sessions_modify on whatsapp_sessions;
create policy whatsapp_sessions_select on whatsapp_sessions for select to authenticated using (owner_id = auth.uid());
create policy whatsapp_sessions_modify on whatsapp_sessions for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists app_rate_limits_all on application_rate_limits;
create policy app_rate_limits_all on application_rate_limits for all to authenticated using (key like '%' || auth.uid()) with check (key like '%' || auth.uid());

-- Seed opcional (produtos demo) - executa apenas se auth.uid() disponível e não existirem produtos
do $$
declare u uuid; begin begin select auth.uid() into u; exception when others then u := null; end; if u is not null then
  if not exists (select 1 from products where owner_id = u) then
    insert into products (owner_id, name, price, category, description, images) values
      (u,'Short praiano M',149.90,'praia','Short leve para praia (tamanhos P-M-G).',array[]::text[]),
      (u,'Camiseta básica P',79.90,'básicos','Camiseta 100% algodão, cores variadas.',array[]::text[]);
  end if; end if; end $$;
