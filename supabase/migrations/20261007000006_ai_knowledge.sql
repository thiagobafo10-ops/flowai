-- IA e conhecimento: agente, base de conhecimento (RAG) e classificações.

create type public.knowledge_status as enum ('processing', 'ready', 'error');
create type public.sentiment as enum ('positive', 'neutral', 'negative');

-- MVP: um único agente por organização.
create table public.ai_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  name text not null,
  personality text not null default '',
  objective text not null default '',
  system_prompt text not null default '' check (char_length(system_prompt) <= 8000),
  tone text not null default 'profissional e cordial',
  auto_reply boolean not null default false,
  human_handoff boolean not null default true,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) <= 200),
  content text not null check (char_length(content) <= 200000),
  status public.knowledge_status not null default 'processing',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create index knowledge_documents_org_idx on public.knowledge_documents (organization_id);

create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null,
  chunk_index int not null,
  content text not null,
  token_count int not null default 0,
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index),
  foreign key (organization_id, document_id)
    references public.knowledge_documents (organization_id, id) on delete cascade
);

create index knowledge_chunks_org_idx on public.knowledge_chunks (organization_id);
create index knowledge_chunks_embedding_idx
  on public.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);

create table public.ai_classifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  message_id uuid not null,
  conversation_id uuid not null,
  intent text,
  sentiment public.sentiment not null,
  lead_score int not null check (lead_score between 0 and 100),
  needs_human boolean not null,
  summary text,
  suggested_stage text,
  model text not null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, message_id)
    references public.messages (organization_id, id) on delete cascade,
  foreign key (organization_id, conversation_id)
    references public.conversations (organization_id, id) on delete cascade
);

create index ai_classifications_message_idx on public.ai_classifications (organization_id, message_id);
create index ai_classifications_conversation_idx
  on public.ai_classifications (organization_id, conversation_id, created_at desc);

-- updated_at
create trigger ai_agents_set_updated_at before update on public.ai_agents
  for each row execute function public.set_updated_at();
create trigger knowledge_documents_set_updated_at before update on public.knowledge_documents
  for each row execute function public.set_updated_at();

-- RLS
alter table public.ai_agents enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks enable row level security;
alter table public.ai_classifications enable row level security;

revoke all on public.ai_agents, public.knowledge_documents, public.knowledge_chunks,
  public.ai_classifications from anon;
revoke truncate, references, trigger on public.ai_agents, public.knowledge_documents,
  public.knowledge_chunks, public.ai_classifications from anon, authenticated;

-- ai_agents: colunas editáveis
revoke update on public.ai_agents from authenticated;
grant update (name, personality, objective, system_prompt, tone, auto_reply, human_handoff, is_active)
  on public.ai_agents to authenticated;

-- knowledge_documents: status/error pertencem ao worker
revoke insert, update on public.knowledge_documents from authenticated;
grant insert (organization_id, title, content) on public.knowledge_documents to authenticated;
grant update (title, content) on public.knowledge_documents to authenticated;

-- chunks e classificações: somente leitura para authenticated (service role escreve)
revoke insert, update, delete on public.knowledge_chunks, public.ai_classifications from authenticated;

-- ai_agents: admin+ escreve
create policy ai_agents_select on public.ai_agents
  for select to authenticated using (public.is_member(organization_id));
create policy ai_agents_insert on public.ai_agents
  for insert to authenticated with check (public.has_role(organization_id, 'admin'));
create policy ai_agents_update on public.ai_agents
  for update to authenticated
  using (public.has_role(organization_id, 'admin'))
  with check (public.has_role(organization_id, 'admin'));
create policy ai_agents_delete on public.ai_agents
  for delete to authenticated using (public.has_role(organization_id, 'admin'));

-- knowledge_documents: admin+ escreve
create policy knowledge_documents_select on public.knowledge_documents
  for select to authenticated using (public.is_member(organization_id));
create policy knowledge_documents_insert on public.knowledge_documents
  for insert to authenticated with check (public.has_role(organization_id, 'admin'));
create policy knowledge_documents_update on public.knowledge_documents
  for update to authenticated
  using (public.has_role(organization_id, 'admin'))
  with check (public.has_role(organization_id, 'admin'));
create policy knowledge_documents_delete on public.knowledge_documents
  for delete to authenticated using (public.has_role(organization_id, 'admin'));

-- chunks / classificações: somente select
create policy knowledge_chunks_select on public.knowledge_chunks
  for select to authenticated using (public.is_member(organization_id));
create policy ai_classifications_select on public.ai_classifications
  for select to authenticated using (public.is_member(organization_id));
