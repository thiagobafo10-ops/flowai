-- Tenancy: organizations, profiles, memberships e helpers de autorização.

-- TRUNCATE/REFERENCES/TRIGGER ignoram RLS: nunca para anon/authenticated (inclui tabelas futuras).
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  company_info jsonb not null default '{}'::jsonb,
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.org_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index memberships_user_id_idx on public.memberships (user_id);

create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger memberships_set_updated_at before update on public.memberships
  for each row execute function public.set_updated_at();

-- Profile automático a partir do cadastro em auth.users.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helpers de autorização (SECURITY DEFINER: leem memberships sem passar por RLS).
create function public.is_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = p_org and m.user_id = (select auth.uid())
  );
$$;

create function public.has_role(p_org uuid, p_min public.org_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = p_org
      and m.user_id = (select auth.uid())
      and public.role_rank(m.role) >= public.role_rank(p_min)
  );
$$;

create function public.shares_org_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user
  );
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.is_member(uuid) from public, anon;
revoke all on function public.has_role(uuid, public.org_role) from public, anon;
revoke all on function public.shares_org_with(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.has_role(uuid, public.org_role) to authenticated;
grant execute on function public.shares_org_with(uuid) to authenticated;

-- RLS
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;

revoke all on public.organizations, public.profiles, public.memberships from anon;
revoke truncate, references, trigger on public.organizations, public.profiles, public.memberships
  from anon, authenticated;

-- Imutabilidade de colunas: só estas colunas são atualizáveis pela API.
revoke update on public.memberships from authenticated;
grant update (role) on public.memberships to authenticated;
revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

-- organizations: sem insert (apenas via RPC)
create policy organizations_select on public.organizations
  for select to authenticated using (public.is_member(id));
create policy organizations_update on public.organizations
  for update to authenticated
  using (public.has_role(id, 'admin'))
  with check (public.has_role(id, 'admin'));
create policy organizations_delete on public.organizations
  for delete to authenticated using (public.has_role(id, 'owner'));

-- profiles: sem insert (trigger), sem delete
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_org_with(id));
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- memberships
create policy memberships_select on public.memberships
  for select to authenticated using (public.is_member(organization_id));
create policy memberships_insert on public.memberships
  for insert to authenticated
  with check (public.has_role(organization_id, 'admin') and role <> 'owner');
create policy memberships_update on public.memberships
  for update to authenticated
  using (
    public.has_role(organization_id, 'admin')
    and user_id <> (select auth.uid())
    and (role <> 'owner' or public.has_role(organization_id, 'owner'))
  )
  with check (
    public.has_role(organization_id, 'admin')
    and user_id <> (select auth.uid())
    and (role <> 'owner' or public.has_role(organization_id, 'owner'))
  );
create policy memberships_delete on public.memberships
  for delete to authenticated
  using (
    public.has_role(organization_id, 'admin')
    and user_id <> (select auth.uid())
    and (role <> 'owner' or public.has_role(organization_id, 'owner'))
  );
