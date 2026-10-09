-- Mensageria: canais, conversas e mensagens (+ Realtime).

create type public.channel_type as enum ('whatsapp', 'instagram');
create type public.channel_status as enum ('needs_setup', 'active', 'error');
create type public.conversation_status as enum ('open', 'pending_human', 'closed');
create type public.handler_type as enum ('ai', 'human');
create type public.message_direction as enum ('inbound', 'outbound');
create type public.sender_type as enum ('contact', 'ai', 'human', 'system', 'automation');
create type public.message_status as enum ('pending', 'sent', 'delivered', 'read', 'failed');

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  type public.channel_type not null,
  name text not null,
  status public.channel_status not null default 'needs_setup',
  external_account_id text,
  waba_id text,
  -- ids de vault.secrets; nulos até a Fase 5. Nunca expostos ao frontend.
  access_token_secret_id uuid,
  app_secret_secret_id uuid,
  verify_token_secret_id uuid,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create unique index channels_type_external_account_key
  on public.channels (type, external_account_id) where external_account_id is not null;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null,
  channel_id uuid not null,
  status public.conversation_status not null default 'open',
  handled_by public.handler_type not null default 'ai',
  assigned_to uuid,
  intent text,
  sentiment text,
  summary text,
  last_message_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, contact_id)
    references public.contacts (organization_id, id) on delete cascade,
  foreign key (organization_id, channel_id)
    references public.channels (organization_id, id) on delete cascade,
  foreign key (organization_id, assigned_to)
    references public.memberships (organization_id, user_id) on delete set null (assigned_to)
);

create index conversations_inbox_idx
  on public.conversations (organization_id, status, last_message_at desc);
create index conversations_contact_idx on public.conversations (organization_id, contact_id);
create index conversations_channel_idx on public.conversations (organization_id, channel_id);
create index conversations_assigned_to_idx on public.conversations (organization_id, assigned_to);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null,
  channel_id uuid not null,
  direction public.message_direction not null,
  sender_type public.sender_type not null,
  sender_user_id uuid,
  content text not null,
  content_type text not null default 'text',
  is_internal_note boolean not null default false,
  external_id text,
  status public.message_status not null default 'pending',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (channel_id, external_id),
  foreign key (organization_id, conversation_id)
    references public.conversations (organization_id, id) on delete cascade,
  foreign key (organization_id, channel_id)
    references public.channels (organization_id, id) on delete cascade,
  foreign key (organization_id, sender_user_id)
    references public.memberships (organization_id, user_id) on delete set null (sender_user_id)
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_channel_idx on public.messages (organization_id, channel_id);
create index messages_sender_user_idx on public.messages (organization_id, sender_user_id);

-- updated_at
create trigger channels_set_updated_at before update on public.channels
  for each row execute function public.set_updated_at();
create trigger conversations_set_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();
create trigger messages_set_updated_at before update on public.messages
  for each row execute function public.set_updated_at();

-- RLS
alter table public.channels enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

revoke all on public.channels, public.conversations, public.messages from anon;
revoke truncate, references, trigger on public.channels, public.conversations, public.messages
  from anon, authenticated;

-- channels: segredos nunca no frontend (privilégios de coluna).
-- Consequência: `select *` em channels falha para authenticated; o app deve listar colunas.
revoke select, insert, update on public.channels from authenticated;
grant select (id, organization_id, type, name, status, external_account_id, waba_id,
  last_error, created_at, updated_at) on public.channels to authenticated;
grant insert (organization_id, type, name) on public.channels to authenticated;
grant update (name, status) on public.channels to authenticated;

-- conversations: organization_id/contact_id/channel_id imutáveis pela API.
revoke insert, update on public.conversations from authenticated;
grant insert (organization_id, contact_id, channel_id, status, handled_by, assigned_to)
  on public.conversations to authenticated;
grant update (status, handled_by, assigned_to, closed_at) on public.conversations to authenticated;
revoke delete on public.conversations from authenticated;

-- messages: conteúdo é histórico imutável; só status/error mudam.
revoke insert, update on public.messages from authenticated;
grant insert (organization_id, conversation_id, channel_id, direction, sender_type,
  sender_user_id, content, content_type, is_internal_note) on public.messages to authenticated;
grant update (status, error) on public.messages to authenticated;
revoke delete on public.messages from authenticated;

-- channels: admin+ escreve
create policy channels_select on public.channels
  for select to authenticated using (public.is_member(organization_id));
create policy channels_insert on public.channels
  for insert to authenticated with check (public.has_role(organization_id, 'admin'));
create policy channels_update on public.channels
  for update to authenticated
  using (public.has_role(organization_id, 'admin'))
  with check (public.has_role(organization_id, 'admin'));
create policy channels_delete on public.channels
  for delete to authenticated using (public.has_role(organization_id, 'admin'));

-- conversations: agent+ escreve; sem delete
create policy conversations_select on public.conversations
  for select to authenticated using (public.is_member(organization_id));
create policy conversations_insert on public.conversations
  for insert to authenticated with check (public.has_role(organization_id, 'agent'));
create policy conversations_update on public.conversations
  for update to authenticated
  using (public.has_role(organization_id, 'agent'))
  with check (public.has_role(organization_id, 'agent'));

-- messages: agent+ insere apenas mensagens humanas outbound próprias; sem delete
create policy messages_select on public.messages
  for select to authenticated using (public.is_member(organization_id));
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    public.has_role(organization_id, 'agent')
    and sender_type = 'human'
    and sender_user_id = (select auth.uid())
    and direction = 'outbound'
  );
create policy messages_update on public.messages
  for update to authenticated
  using (public.has_role(organization_id, 'agent'))
  with check (public.has_role(organization_id, 'agent'));

-- Realtime (RLS se aplica aos assinantes)
alter publication supabase_realtime add table public.messages, public.conversations, public.deals;
