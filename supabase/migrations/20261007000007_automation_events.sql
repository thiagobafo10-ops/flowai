-- Automações (grafo, runs, steps) e eventos de domínio.

create type public.automation_status as enum ('draft', 'active', 'paused');
create type public.automation_node_type as enum (
  'trigger', 'condition', 'message', 'delay', 'tag', 'remove_tag',
  'assign_user', 'move_stage', 'ai', 'webhook', 'close_conversation', 'end'
);
create type public.automation_trigger_type as enum (
  'message_received', 'keyword_detected', 'conversation_created',
  'tag_added', 'stage_changed', 'contact_created'
);
create type public.run_status as enum ('pending', 'running', 'waiting', 'completed', 'failed', 'cancelled');

-- Eventos de domínio (fonte para triggers e métricas). Append-only.
create table public.events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  type text not null,
  conversation_id uuid,
  contact_id uuid,
  deal_id uuid,
  actor_type text not null check (actor_type in ('user', 'ai', 'system', 'automation', 'contact')),
  actor_id uuid,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, conversation_id)
    references public.conversations (organization_id, id) on delete set null (conversation_id),
  foreign key (organization_id, contact_id)
    references public.contacts (organization_id, id) on delete set null (contact_id),
  foreign key (organization_id, deal_id)
    references public.deals (organization_id, id) on delete set null (deal_id)
);

create index events_org_type_created_idx on public.events (organization_id, type, created_at);

create table public.automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  description text,
  status public.automation_status not null default 'draft',
  trigger_type public.automation_trigger_type not null,
  created_by_ai boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, created_by)
    references public.memberships (organization_id, user_id) on delete set null (created_by)
);

create index automations_org_status_idx on public.automations (organization_id, status, trigger_type);

create table public.automation_nodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  automation_id uuid not null,
  type public.automation_node_type not null,
  config jsonb not null default '{}',
  position jsonb not null default '{"x":0,"y":0}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, automation_id, id),
  foreign key (organization_id, automation_id)
    references public.automations (organization_id, id) on delete cascade
);

create index automation_nodes_automation_idx on public.automation_nodes (organization_id, automation_id);

create table public.automation_edges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  automation_id uuid not null,
  source_node_id uuid not null,
  target_node_id uuid not null,
  source_handle text not null default 'default' check (source_handle in ('default', 'true', 'false')),
  created_at timestamptz not null default now(),
  foreign key (organization_id, automation_id)
    references public.automations (organization_id, id) on delete cascade,
  foreign key (organization_id, automation_id, source_node_id)
    references public.automation_nodes (organization_id, automation_id, id) on delete cascade,
  foreign key (organization_id, automation_id, target_node_id)
    references public.automation_nodes (organization_id, automation_id, id) on delete cascade
);

create index automation_edges_automation_idx on public.automation_edges (organization_id, automation_id);

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  automation_id uuid not null,
  trigger_event_id uuid not null,
  conversation_id uuid,
  contact_id uuid,
  status public.run_status not null default 'pending',
  current_node_id uuid,
  resume_at timestamptz,
  step_count int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (automation_id, trigger_event_id),
  unique (organization_id, id),
  foreign key (organization_id, automation_id)
    references public.automations (organization_id, id) on delete cascade,
  foreign key (organization_id, trigger_event_id)
    references public.events (organization_id, id) on delete cascade,
  foreign key (organization_id, conversation_id)
    references public.conversations (organization_id, id) on delete set null (conversation_id),
  foreign key (organization_id, contact_id)
    references public.contacts (organization_id, id) on delete set null (contact_id),
  foreign key (organization_id, automation_id, current_node_id)
    references public.automation_nodes (organization_id, automation_id, id) on delete set null (current_node_id)
);

create index automation_runs_waiting_idx on public.automation_runs (status, resume_at) where status = 'waiting';
create index automation_runs_org_idx on public.automation_runs (organization_id, automation_id, created_at desc);

create table public.automation_run_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  run_id uuid not null,
  node_id uuid not null,
  iteration int not null default 0,
  status public.run_status not null,
  output jsonb,
  error text,
  created_at timestamptz not null default now(),
  unique (run_id, node_id, iteration),
  foreign key (organization_id, run_id)
    references public.automation_runs (organization_id, id) on delete cascade,
  foreign key (organization_id, node_id)
    references public.automation_nodes (organization_id, id) on delete cascade
);

create index automation_run_steps_org_idx on public.automation_run_steps (organization_id, run_id);

-- updated_at
create trigger automations_set_updated_at before update on public.automations
  for each row execute function public.set_updated_at();
create trigger automation_nodes_set_updated_at before update on public.automation_nodes
  for each row execute function public.set_updated_at();
create trigger automation_runs_set_updated_at before update on public.automation_runs
  for each row execute function public.set_updated_at();

-- RLS e grants
alter table public.events enable row level security;
alter table public.automations enable row level security;
alter table public.automation_nodes enable row level security;
alter table public.automation_edges enable row level security;
alter table public.automation_runs enable row level security;
alter table public.automation_run_steps enable row level security;

revoke all on public.events, public.automations, public.automation_nodes, public.automation_edges,
  public.automation_runs, public.automation_run_steps from anon;
revoke truncate, references, trigger on public.events, public.automations, public.automation_nodes,
  public.automation_edges, public.automation_runs, public.automation_run_steps from anon, authenticated;

revoke update on public.automations from authenticated;
grant update (name, description, status, trigger_type) on public.automations to authenticated;

revoke update on public.automation_nodes from authenticated;
grant update (type, config, position) on public.automation_nodes to authenticated;

revoke update on public.automation_edges from authenticated;

revoke insert, update, delete on public.automation_runs, public.automation_run_steps from authenticated;

revoke insert, update, delete on public.events from authenticated;
grant insert (organization_id, type, conversation_id, contact_id, deal_id, actor_type, actor_id, payload)
  on public.events to authenticated;

-- automations / nodes / edges: select membro, escrita admin+
create policy automations_select on public.automations
  for select to authenticated using (public.is_member(organization_id));
create policy automations_insert on public.automations
  for insert to authenticated with check (public.has_role(organization_id, 'admin'));
create policy automations_update on public.automations
  for update to authenticated
  using (public.has_role(organization_id, 'admin'))
  with check (public.has_role(organization_id, 'admin'));
create policy automations_delete on public.automations
  for delete to authenticated using (public.has_role(organization_id, 'admin'));

create policy automation_nodes_select on public.automation_nodes
  for select to authenticated using (public.is_member(organization_id));
create policy automation_nodes_insert on public.automation_nodes
  for insert to authenticated with check (public.has_role(organization_id, 'admin'));
create policy automation_nodes_update on public.automation_nodes
  for update to authenticated
  using (public.has_role(organization_id, 'admin'))
  with check (public.has_role(organization_id, 'admin'));
create policy automation_nodes_delete on public.automation_nodes
  for delete to authenticated using (public.has_role(organization_id, 'admin'));

create policy automation_edges_select on public.automation_edges
  for select to authenticated using (public.is_member(organization_id));
create policy automation_edges_insert on public.automation_edges
  for insert to authenticated with check (public.has_role(organization_id, 'admin'));
create policy automation_edges_delete on public.automation_edges
  for delete to authenticated using (public.has_role(organization_id, 'admin'));

-- runs / steps: somente leitura (service role escreve)
create policy automation_runs_select on public.automation_runs
  for select to authenticated using (public.is_member(organization_id));
create policy automation_run_steps_select on public.automation_run_steps
  for select to authenticated using (public.is_member(organization_id));

-- events: leitura por membro; insert por agent+ como o próprio usuário
create policy events_select on public.events
  for select to authenticated using (public.is_member(organization_id));
create policy events_insert on public.events
  for insert to authenticated
  with check (
    public.has_role(organization_id, 'agent')
    and actor_type = 'user'
    and actor_id = (select auth.uid())
  );
