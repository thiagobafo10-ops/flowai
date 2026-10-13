-- Fase 7A (automações): esquema estendido. Os novos valores de enum só são usados a partir da 000002.

alter type public.automation_trigger_type add value if not exists 'instagram_comment';
alter type public.automation_trigger_type add value if not exists 'instagram_story';
alter type public.automation_node_type add value if not exists 'handoff_ai';
alter type public.automation_node_type add value if not exists 'handoff_human';

-- Saídas (handles) de aresta.
alter table public.automation_edges drop constraint automation_edges_source_handle_check;
alter table public.automation_edges add constraint automation_edges_source_handle_check
  check (source_handle ~ '^(default|true|false|no_reply|sent|handoff|opt:[a-z0-9]{1,12})$');

alter table public.automations
  add column trigger_config jsonb not null default '{}',
  add column activated_at timestamptz,
  add column current_version int not null default 0;

-- Escrita somente pelas funções de autoria (000002).
revoke insert, update, delete on public.automations, public.automation_nodes, public.automation_edges from authenticated;
revoke update (name, description, status, trigger_type) on public.automations from authenticated;
revoke update (type, config, position) on public.automation_nodes from authenticated;
drop policy automations_insert on public.automations;
drop policy automations_update on public.automations;
drop policy automations_delete on public.automations;
drop policy automation_nodes_insert on public.automation_nodes;
drop policy automation_nodes_update on public.automation_nodes;
drop policy automation_nodes_delete on public.automation_nodes;
drop policy automation_edges_insert on public.automation_edges;
drop policy automation_edges_delete on public.automation_edges;

-- Versões imutáveis do grafo.
create table public.automation_versions (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  automation_id uuid not null,
  version int not null check (version >= 1),
  trigger_type public.automation_trigger_type not null,
  trigger_config jsonb not null default '{}',
  graph jsonb not null,
  created_at timestamptz not null default now(),
  primary key (automation_id, version),
  foreign key (organization_id, automation_id)
    references public.automations (organization_id, id) on delete cascade
);
create index automation_versions_org_idx on public.automation_versions (organization_id, automation_id);
alter table public.automation_versions enable row level security;
revoke all on public.automation_versions from anon, authenticated;
grant select on public.automation_versions to authenticated;
create policy automation_versions_select on public.automation_versions
  for select to authenticated using (public.is_member(organization_id));

-- Execuções.
alter table public.automation_runs
  add column version int,
  add column waiting_for text check (waiting_for in ('delay', 'reply')),
  add column wait_node_id uuid,
  add column attempts int not null default 0,
  add column claim_token uuid,
  add column claimed_until timestamptz,
  add column iteration int not null default 0,
  add column input jsonb;
create index automation_runs_due_idx on public.automation_runs (status, resume_at)
  where status in ('pending', 'waiting');

alter table public.automation_run_steps add column handle text;

-- Conversa em automação (somente leitura para membros).
alter table public.conversations add column automation_run_id uuid;
alter table public.conversations add constraint conversations_automation_run_fk
  foreign key (organization_id, automation_run_id)
  references public.automation_runs (organization_id, id) on delete set null (automation_run_id);
create index conversations_automation_run_idx on public.conversations (automation_run_id)
  where automation_run_id is not null;

-- Instagram: payload estruturado (botões / respostas rápidas) e vínculo com a execução.
alter table public.instagram_send_intents
  add column message_payload jsonb,
  add column automation_run_id uuid;
alter table public.instagram_send_intents add constraint instagram_intents_automation_run_fk
  foreign key (organization_id, automation_run_id)
  references public.automation_runs (organization_id, id) on delete set null (automation_run_id);

-- Segredo de assinatura dos payloads de clique (Vault; id em tabela privada).
create table private.automation_secrets (
  singleton boolean primary key default true check (singleton),
  payload_secret_id uuid not null
);
alter table private.automation_secrets enable row level security;
revoke all on private.automation_secrets from anon, authenticated;
insert into private.automation_secrets (payload_secret_id)
  select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'flowai-automation-payload-secret');
