-- Cria trigger para auto criar store ao inserir novo usuário no auth.users
-- Ajuste se já existir algo semelhante

create or replace function public.create_store_for_new_user()
returns trigger as $$
declare
  v_store_id uuid;
begin
  -- Evita duplicar caso já exista (idempotência básica)
  select id into v_store_id from stores where owner_id = NEW.id limit 1;
  if v_store_id is not null then
    return NEW;
  end if;

  insert into stores (owner_id, name, description)
    values (NEW.id, 'Santê Loja', 'Criada automaticamente')
    returning id into v_store_id;

  insert into whatsapp_configs (store_id)
    values (v_store_id)
    on conflict (store_id) do nothing;

  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.create_store_for_new_user();

-- Policies de segurança (ajuste se já existirem). Garante que usuário só lê sua store.
alter table public.stores enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'stores' and policyname = 'owner_can_select_store') then
    create policy owner_can_select_store on public.stores for select using (auth.uid() = owner_id);
  end if;
end $$;
