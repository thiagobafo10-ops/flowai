-- CRM: contatos, campos customizados, tags, pipelines, stages e deals.

create type public.contact_source as enum ('whatsapp', 'instagram', 'manual');
create type public.contact_status as enum ('lead', 'customer', 'inactive');
create type public.deal_status as enum ('open', 'won', 'lost');

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text,
  phone text,
  email text,
  avatar_url text,
  source public.contact_source not null default 'manual',
  status public.contact_status not null default 'lead',
  lead_score int not null default 0 check (lead_score between 0 and 100),
  assigned_to uuid,
  last_interaction_at timestamptz,
  whatsapp_id text,
  instagram_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, assigned_to)
    references public.memberships (organization_id, user_id) on delete set null (assigned_to)
);

create unique index contacts_org_whatsapp_id_key
  on public.contacts (organization_id, whatsapp_id) where whatsapp_id is not null;
create unique index contacts_org_instagram_id_key
  on public.contacts (organization_id, instagram_id) where instagram_id is not null;
create index contacts_assigned_to_idx on public.contacts (organization_id, assigned_to);

create table public.contact_custom_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null,
  key text not null,
  value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (contact_id, key),
  foreign key (organization_id, contact_id)
    references public.contacts (organization_id, id) on delete cascade
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  color text not null default '#6b7280',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create unique index tags_org_lower_name_key on public.tags (organization_id, lower(name));

create table public.contact_tags (
  contact_id uuid not null,
  tag_id uuid not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (contact_id, tag_id),
  foreign key (organization_id, contact_id)
    references public.contacts (organization_id, id) on delete cascade,
  foreign key (organization_id, tag_id)
    references public.tags (organization_id, id) on delete cascade
);

create index contact_tags_tag_idx on public.contact_tags (organization_id, tag_id);

create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create unique index pipelines_one_default_per_org
  on public.pipelines (organization_id) where is_default;

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  pipeline_id uuid not null,
  name text not null,
  position int not null,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, pipeline_id, id),
  unique (pipeline_id, position) deferrable initially deferred,
  check (not (is_won and is_lost)),
  foreign key (organization_id, pipeline_id)
    references public.pipelines (organization_id, id) on delete cascade
);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  pipeline_id uuid not null,
  stage_id uuid not null,
  contact_id uuid not null,
  title text not null,
  value numeric(14, 2) not null default 0,
  currency text not null default 'BRL',
  status public.deal_status not null default 'open',
  owner_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, contact_id)
    references public.contacts (organization_id, id) on delete cascade,
  foreign key (organization_id, pipeline_id)
    references public.pipelines (organization_id, id) on delete restrict,
  foreign key (organization_id, pipeline_id, stage_id)
    references public.pipeline_stages (organization_id, pipeline_id, id) on delete restrict,
  foreign key (organization_id, owner_id)
    references public.memberships (organization_id, user_id) on delete set null (owner_id)
);

create unique index deals_one_open_per_contact_pipeline
  on public.deals (contact_id, pipeline_id) where status = 'open';
create index deals_stage_idx on public.deals (stage_id);
create index deals_org_status_idx on public.deals (organization_id, status);
create index deals_owner_idx on public.deals (organization_id, owner_id);

-- updated_at
create trigger contacts_set_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();
create trigger contact_custom_fields_set_updated_at before update on public.contact_custom_fields
  for each row execute function public.set_updated_at();
create trigger tags_set_updated_at before update on public.tags
  for each row execute function public.set_updated_at();
create trigger contact_tags_set_updated_at before update on public.contact_tags
  for each row execute function public.set_updated_at();
create trigger pipelines_set_updated_at before update on public.pipelines
  for each row execute function public.set_updated_at();
create trigger pipeline_stages_set_updated_at before update on public.pipeline_stages
  for each row execute function public.set_updated_at();
create trigger deals_set_updated_at before update on public.deals
  for each row execute function public.set_updated_at();

-- RLS
alter table public.contacts enable row level security;
alter table public.contact_custom_fields enable row level security;
alter table public.tags enable row level security;
alter table public.contact_tags enable row level security;
alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.deals enable row level security;

revoke all on public.contacts, public.contact_custom_fields, public.tags, public.contact_tags,
  public.pipelines, public.pipeline_stages, public.deals from anon;
revoke truncate, references, trigger on public.contacts, public.contact_custom_fields, public.tags,
  public.contact_tags, public.pipelines, public.pipeline_stages, public.deals from anon, authenticated;

-- organization_id é imutável pela API.
revoke update on public.contacts, public.contact_custom_fields, public.tags, public.contact_tags,
  public.pipelines, public.pipeline_stages, public.deals from authenticated;
grant update (name, phone, email, avatar_url, source, status, lead_score, assigned_to,
  last_interaction_at, whatsapp_id, instagram_id) on public.contacts to authenticated;
grant update (key, value) on public.contact_custom_fields to authenticated;
grant update (name, color) on public.tags to authenticated;
grant update (name, is_default) on public.pipelines to authenticated;
grant update (name, position, is_won, is_lost) on public.pipeline_stages to authenticated;
grant update (stage_id, title, value, currency, status, owner_id) on public.deals to authenticated;

-- contacts, tags, deals: agent+ escreve; admin+ deleta
create policy contacts_select on public.contacts
  for select to authenticated using (public.is_member(organization_id));
create policy contacts_insert on public.contacts
  for insert to authenticated with check (public.has_role(organization_id, 'agent'));
create policy contacts_update on public.contacts
  for update to authenticated
  using (public.has_role(organization_id, 'agent'))
  with check (public.has_role(organization_id, 'agent'));
create policy contacts_delete on public.contacts
  for delete to authenticated using (public.has_role(organization_id, 'admin'));

create policy tags_select on public.tags
  for select to authenticated using (public.is_member(organization_id));
create policy tags_insert on public.tags
  for insert to authenticated with check (public.has_role(organization_id, 'agent'));
create policy tags_update on public.tags
  for update to authenticated
  using (public.has_role(organization_id, 'agent'))
  with check (public.has_role(organization_id, 'agent'));
create policy tags_delete on public.tags
  for delete to authenticated using (public.has_role(organization_id, 'admin'));

create policy deals_select on public.deals
  for select to authenticated using (public.is_member(organization_id));
create policy deals_insert on public.deals
  for insert to authenticated with check (public.has_role(organization_id, 'agent'));
create policy deals_update on public.deals
  for update to authenticated
  using (public.has_role(organization_id, 'agent'))
  with check (public.has_role(organization_id, 'agent'));
create policy deals_delete on public.deals
  for delete to authenticated using (public.has_role(organization_id, 'admin'));

-- contact_custom_fields, contact_tags: agent+ escreve e deleta
create policy contact_custom_fields_select on public.contact_custom_fields
  for select to authenticated using (public.is_member(organization_id));
create policy contact_custom_fields_insert on public.contact_custom_fields
  for insert to authenticated with check (public.has_role(organization_id, 'agent'));
create policy contact_custom_fields_update on public.contact_custom_fields
  for update to authenticated
  using (public.has_role(organization_id, 'agent'))
  with check (public.has_role(organization_id, 'agent'));
create policy contact_custom_fields_delete on public.contact_custom_fields
  for delete to authenticated using (public.has_role(organization_id, 'agent'));

create policy contact_tags_select on public.contact_tags
  for select to authenticated using (public.is_member(organization_id));
create policy contact_tags_insert on public.contact_tags
  for insert to authenticated with check (public.has_role(organization_id, 'agent'));
create policy contact_tags_update on public.contact_tags
  for update to authenticated
  using (public.has_role(organization_id, 'agent'))
  with check (public.has_role(organization_id, 'agent'));
create policy contact_tags_delete on public.contact_tags
  for delete to authenticated using (public.has_role(organization_id, 'agent'));

-- pipelines, pipeline_stages: admin+
create policy pipelines_select on public.pipelines
  for select to authenticated using (public.is_member(organization_id));
create policy pipelines_insert on public.pipelines
  for insert to authenticated with check (public.has_role(organization_id, 'admin'));
create policy pipelines_update on public.pipelines
  for update to authenticated
  using (public.has_role(organization_id, 'admin'))
  with check (public.has_role(organization_id, 'admin'));
create policy pipelines_delete on public.pipelines
  for delete to authenticated using (public.has_role(organization_id, 'admin'));

create policy pipeline_stages_select on public.pipeline_stages
  for select to authenticated using (public.is_member(organization_id));
create policy pipeline_stages_insert on public.pipeline_stages
  for insert to authenticated with check (public.has_role(organization_id, 'admin'));
create policy pipeline_stages_update on public.pipeline_stages
  for update to authenticated
  using (public.has_role(organization_id, 'admin'))
  with check (public.has_role(organization_id, 'admin'));
create policy pipeline_stages_delete on public.pipeline_stages
  for delete to authenticated using (public.has_role(organization_id, 'admin'));
