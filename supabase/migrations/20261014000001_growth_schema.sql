-- Fase 7B (crescimento): links de entrada, sequências, campanhas e fila de entregas.
-- Os novos valores de enum só são usados a partir da 20261014000002 (não podem ser usados na mesma transação).

alter type public.automation_trigger_type add value if not exists 'entry_link';
alter type public.automation_node_type add value if not exists 'sequence_enroll';
alter type public.automation_node_type add value if not exists 'sequence_remove';

-- Usuário da conta do Instagram (link https://ig.me/m/<usuário>): escrito pelo serviço ou por set_instagram_username.
alter table public.channels add column instagram_username text
  check (instagram_username ~ '^[a-z0-9._]{1,30}$');
grant select (instagram_username) on public.channels to authenticated;

-- Links de entrada.
create table public.entry_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  channel_id uuid not null,
  code text not null check (code ~ '^[a-z0-9_-]{3,40}$'),
  tag_id uuid,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint entry_links_channel_code_key unique (channel_id, code),
  foreign key (organization_id, channel_id) references public.channels (organization_id, id) on delete cascade,
  foreign key (organization_id, tag_id) references public.tags (organization_id, id) on delete set null (tag_id)
);
create index entry_links_org_idx on public.entry_links (organization_id, created_at desc);
create index entry_links_tag_idx on public.entry_links (organization_id, tag_id) where tag_id is not null;

create table public.entry_link_hits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  link_id uuid not null,
  contact_id uuid,
  conversation_id uuid,
  external_id text not null check (char_length(external_id) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (link_id, external_id),
  foreign key (organization_id, link_id) references public.entry_links (organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id)
    on delete set null (contact_id),
  foreign key (organization_id, conversation_id) references public.conversations (organization_id, id)
    on delete set null (conversation_id)
);
create index entry_link_hits_link_idx on public.entry_link_hits (organization_id, link_id, created_at);
create index entry_link_hits_contact_idx on public.entry_link_hits (organization_id, contact_id) where contact_id is not null;
create index entry_link_hits_conversation_idx on public.entry_link_hits (conversation_id) where conversation_id is not null;

-- Sequências.
create table public.sequences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  settings jsonb not null default '{}' check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index sequences_org_idx on public.sequences (organization_id, created_at desc);
create trigger sequences_set_updated_at before update on public.sequences
  for each row execute function public.set_updated_at();

-- Passo removido de uma sequência que já teve entregas fica com removed_at (e sem posição) para manter o histórico.
create table public.sequence_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sequence_id uuid not null,
  position int check (position >= 1),
  delay_minutes int not null check (delay_minutes between 1 and 43200),
  "window" jsonb check ("window" is null or jsonb_typeof("window") = 'object'),
  message jsonb not null check (jsonb_typeof(message) = 'object'),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint sequence_steps_sequence_position_key unique (sequence_id, position) deferrable initially deferred,
  check ((removed_at is null) = (position is not null)),
  foreign key (organization_id, sequence_id) references public.sequences (organization_id, id) on delete cascade
);
create index sequence_steps_org_idx on public.sequence_steps (organization_id, sequence_id);

create table public.sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sequence_id uuid not null,
  contact_id uuid not null,
  channel_id uuid not null,
  current_position int not null default 1 check (current_position >= 1),
  next_send_at timestamptz,
  status text not null default 'active' check (status in ('active', 'completed', 'exited', 'removed')),
  exit_reason text check (exit_reason ~ '^[a-z0-9_]{1,64}$'),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, sequence_id) references public.sequences (organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade,
  foreign key (organization_id, channel_id) references public.channels (organization_id, id) on delete cascade
);
create unique index sequence_enrollments_one_active_key
  on public.sequence_enrollments (sequence_id, contact_id) where status = 'active';
create index sequence_enrollments_contact_idx on public.sequence_enrollments (organization_id, contact_id);
create index sequence_enrollments_sequence_idx on public.sequence_enrollments (organization_id, sequence_id, status);
create index sequence_enrollments_channel_idx on public.sequence_enrollments (organization_id, channel_id);

-- Campanhas.
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'sending', 'completed', 'cancelled')),
  audience jsonb not null default '{}' check (jsonb_typeof(audience) = 'object'),
  message jsonb not null default '{}' check (jsonb_typeof(message) = 'object'),
  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  counters jsonb not null default '{}' check (jsonb_typeof(counters) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index campaigns_org_idx on public.campaigns (organization_id, created_at desc);
create index campaigns_due_idx on public.campaigns (scheduled_at) where status = 'scheduled';
create trigger campaigns_set_updated_at before update on public.campaigns
  for each row execute function public.set_updated_at();

-- Fila única de entregas (sequência ou campanha). Inscrição/passo/contato/conversa apagados
-- mantêm a linha (FK set null) para o histórico; o worker trata a ausência.
create table public.outreach_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source text not null check (source in ('sequence', 'campaign')),
  enrollment_id uuid,
  step_id uuid,
  campaign_id uuid,
  contact_id uuid,
  channel_id uuid not null,
  conversation_id uuid,
  run_after timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'skipped', 'failed', 'cancelled')),
  reason text check (reason ~ '^[a-z0-9_]{1,64}$'),
  postponements int not null default 0 check (postponements >= 0),
  attempts int not null default 0 check (attempts >= 0),
  claim_token uuid,
  claimed_until timestamptz,
  message_id uuid,
  intent_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  check (case source
    when 'campaign' then campaign_id is not null and enrollment_id is null and step_id is null
    else campaign_id is null end),
  foreign key (organization_id, enrollment_id) references public.sequence_enrollments (organization_id, id)
    on delete set null (enrollment_id),
  foreign key (organization_id, step_id) references public.sequence_steps (organization_id, id)
    on delete set null (step_id),
  foreign key (organization_id, campaign_id) references public.campaigns (organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id)
    on delete set null (contact_id),
  foreign key (organization_id, channel_id) references public.channels (organization_id, id) on delete cascade,
  foreign key (organization_id, conversation_id) references public.conversations (organization_id, id)
    on delete set null (conversation_id),
  foreign key (organization_id, message_id) references public.messages (organization_id, id)
    on delete set null (message_id),
  foreign key (intent_id) references public.instagram_send_intents (id) on delete set null
);
create unique index outreach_deliveries_campaign_contact_key
  on public.outreach_deliveries (campaign_id, contact_id) where campaign_id is not null;
create unique index outreach_deliveries_enrollment_step_key on public.outreach_deliveries (enrollment_id, step_id);
create index outreach_deliveries_due_idx on public.outreach_deliveries (status, run_after)
  where status in ('pending', 'sending');
create index outreach_deliveries_step_idx on public.outreach_deliveries (step_id) where step_id is not null;
create index outreach_deliveries_campaign_idx on public.outreach_deliveries (organization_id, campaign_id, status);
create index outreach_deliveries_contact_idx on public.outreach_deliveries (organization_id, contact_id);
create index outreach_deliveries_channel_idx on public.outreach_deliveries (organization_id, channel_id);
create index outreach_deliveries_conversation_idx on public.outreach_deliveries (conversation_id)
  where conversation_id is not null;
create index outreach_deliveries_message_idx on public.outreach_deliveries (message_id) where message_id is not null;
create index outreach_deliveries_intent_idx on public.outreach_deliveries (intent_id) where intent_id is not null;
create trigger outreach_deliveries_set_updated_at before update on public.outreach_deliveries
  for each row execute function public.set_updated_at();

-- Configuração da plataforma (somente serviço).
create table private.outreach_settings (
  singleton boolean primary key default true check (singleton),
  campaign_rate_per_minute int not null default 30 check (campaign_rate_per_minute between 1 and 1000)
);
alter table private.outreach_settings enable row level security;
revoke all on private.outreach_settings from public, anon, authenticated;
insert into private.outreach_settings default values;

-- RLS: membros leem a própria organização; escrita só pelas funções.
alter table public.entry_links enable row level security;
alter table public.entry_link_hits enable row level security;
alter table public.sequences enable row level security;
alter table public.sequence_steps enable row level security;
alter table public.sequence_enrollments enable row level security;
alter table public.campaigns enable row level security;
alter table public.outreach_deliveries enable row level security;
revoke all on public.entry_links, public.entry_link_hits, public.sequences, public.sequence_steps,
  public.sequence_enrollments, public.campaigns, public.outreach_deliveries from anon, authenticated;
grant select on public.entry_links, public.entry_link_hits, public.sequences, public.sequence_steps,
  public.sequence_enrollments, public.campaigns to authenticated;
grant select (id, organization_id, source, enrollment_id, step_id, campaign_id, contact_id, channel_id,
  conversation_id, run_after, status, reason, postponements, attempts, message_id, intent_id, created_at, updated_at)
  on public.outreach_deliveries to authenticated;
create policy entry_links_select on public.entry_links
  for select to authenticated using (public.is_member(organization_id));
create policy entry_link_hits_select on public.entry_link_hits
  for select to authenticated using (public.is_member(organization_id));
create policy sequences_select on public.sequences
  for select to authenticated using (public.is_member(organization_id));
create policy sequence_steps_select on public.sequence_steps
  for select to authenticated using (public.is_member(organization_id));
create policy sequence_enrollments_select on public.sequence_enrollments
  for select to authenticated using (public.is_member(organization_id));
create policy campaigns_select on public.campaigns
  for select to authenticated using (public.is_member(organization_id));
create policy outreach_deliveries_select on public.outreach_deliveries
  for select to authenticated using (public.is_member(organization_id));

-- Validação estrutural (a validação completa fica nas server actions, com o core).
create function private.is_uuid_text(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(p) = 'string'
    and (p #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)
$$;

-- Array (opcionalmente ausente) de UUIDs distintos.
create function private.is_uuid_array(p jsonb, p_min int default 0) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(p) = 'array' and jsonb_array_length(p) >= p_min
    and not exists (select 1 from jsonb_array_elements(p) e where not private.is_uuid_text(e))
    and (select count(distinct e) = count(*) from jsonb_array_elements(p) e), false)
$$;

create function private.is_int_between(p jsonb, p_min int, p_max int) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(p) = 'number' and (p #>> '{}')::numeric = trunc((p #>> '{}')::numeric)
    and (p #>> '{}')::numeric between p_min and p_max, false)
$$;

create function private.valid_send_window(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare v_hhmm constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
  if p is null or jsonb_typeof(p) = 'null' then return true; end if;
  if jsonb_typeof(p) <> 'object' or jsonb_typeof(p -> 'days') is distinct from 'array'
     or jsonb_array_length(p -> 'days') not between 1 and 7
     or exists (select 1 from jsonb_array_elements(p -> 'days') d where not private.is_int_between(d, 1, 7))
     or (select count(distinct d) <> count(*) from jsonb_array_elements(p -> 'days') d)
     or jsonb_typeof(p -> 'start') is distinct from 'string' or jsonb_typeof(p -> 'end') is distinct from 'string'
     or (p ->> 'start') !~ v_hhmm or (p ->> 'end') !~ v_hhmm or (p ->> 'start') >= (p ->> 'end') then
    return false;
  end if;
  return true;
end $$;

-- Mensagem de sequência/campanha: texto ≤ 4096; até 3 botões (url https | automation) ou até 13 respostas rápidas.
create function private.valid_outreach_message(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare o jsonb; v_ids text[] := '{}'; v_buttons int; v_replies int;
begin
  if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p -> 'text') is distinct from 'string'
     or char_length(p ->> 'text') not between 1 and 4096 then
    return false;
  end if;
  if coalesce(jsonb_typeof(p -> 'buttons'), 'null') not in ('null', 'array')
     or coalesce(jsonb_typeof(p -> 'quickReplies'), 'null') not in ('null', 'array') then
    return false;
  end if;
  v_buttons := case when jsonb_typeof(p -> 'buttons') = 'array' then jsonb_array_length(p -> 'buttons') else 0 end;
  v_replies := case when jsonb_typeof(p -> 'quickReplies') = 'array' then jsonb_array_length(p -> 'quickReplies') else 0 end;
  if v_buttons > 3 or v_replies > 13 or (v_buttons > 0 and v_replies > 0) then return false; end if;
  for o in select e from jsonb_array_elements(case when v_buttons > 0 then p -> 'buttons' else '[]'::jsonb end) e
    union all select e from jsonb_array_elements(case when v_replies > 0 then p -> 'quickReplies' else '[]'::jsonb end) e loop
    if jsonb_typeof(o) <> 'object' or jsonb_typeof(o -> 'id') is distinct from 'string'
       or (o ->> 'id') !~ '^[a-z0-9]{1,12}$' or (o ->> 'id') = any (v_ids)
       or jsonb_typeof(o -> 'title') is distinct from 'string' or char_length(btrim(o ->> 'title')) not between 1 and 20 then
      return false;
    end if;
    v_ids := v_ids || (o ->> 'id');
  end loop;
  if v_buttons > 0 and exists (select 1 from jsonb_array_elements(p -> 'buttons') b where not (
      ((b ->> 'kind') = 'url' and jsonb_typeof(b -> 'url') = 'string' and (b ->> 'url') ~ '^https://[^\s]+$')
      or ((b ->> 'kind') = 'automation' and private.is_uuid_text(b -> 'automationId')))) then
    return false;
  end if;
  if v_replies > 0 and exists (select 1 from jsonb_array_elements(p -> 'quickReplies') q
      where not private.is_uuid_text(q -> 'automationId')) then
    return false;
  end if;
  return true;
end $$;

-- Configurações de sequência: canais da organização, exitOnReply e palavras de saída.
create function private.valid_sequence_settings(p_org uuid, p jsonb) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if jsonb_typeof(p) is distinct from 'object' or not private.is_uuid_array(p -> 'channelIds', 1) then return false; end if;
  if exists (select 1 from jsonb_array_elements_text(p -> 'channelIds') c
      where not exists (select 1 from public.channels ch where ch.id = c::uuid and ch.organization_id = p_org)) then
    return false;
  end if;
  if coalesce(jsonb_typeof(p -> 'exitOnReply'), 'boolean') <> 'boolean' then return false; end if;
  if p ? 'exitWords' and (jsonb_typeof(p -> 'exitWords') <> 'array' or exists (
      select 1 from jsonb_array_elements(p -> 'exitWords') w
      where jsonb_typeof(w) <> 'string' or char_length(btrim(w #>> '{}')) not between 1 and 30)) then
    return false;
  end if;
  return true;
end $$;

-- Público de campanha: estrutura do audienceFilterSchema; canais da organização.
create function private.valid_campaign_audience(p_org uuid, p jsonb) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare k text;
begin
  if jsonb_typeof(p) is distinct from 'object' or not private.is_uuid_array(p -> 'channelIds', 1) then return false; end if;
  if exists (select 1 from jsonb_array_elements_text(p -> 'channelIds') c
      where not exists (select 1 from public.channels ch where ch.id = c::uuid and ch.organization_id = p_org)) then
    return false;
  end if;
  foreach k in array array['tagsAll', 'tagsAny', 'tagsNone', 'stageIds', 'entryLinkIds'] loop
    if p ? k and not private.is_uuid_array(p -> k) then return false; end if;
  end loop;
  if coalesce(jsonb_typeof(p -> 'minLeadScore'), 'null') <> 'null' and not private.is_int_between(p -> 'minLeadScore', 0, 100) then
    return false;
  end if;
  if coalesce(jsonb_typeof(p -> 'lastInteractionDays'), 'null') <> 'null'
     and not private.is_int_between(p -> 'lastInteractionDays', 1, 365) then
    return false;
  end if;
  return true;
end $$;

-- Código de link: 8 caracteres [a-z0-9].
create function private.generate_link_code() returns text
language sql volatile set search_path = '' as $$
  select string_agg(substr('abcdefghijklmnopqrstuvwxyz0123456789', (get_byte(b, i) % 36) + 1, 1), '' order by i)
  from (select extensions.gen_random_bytes(8) as b) x, generate_series(0, 7) i
$$;

revoke all on function private.is_uuid_text(jsonb), private.is_uuid_array(jsonb, int), private.is_int_between(jsonb, int, int),
  private.valid_send_window(jsonb), private.valid_outreach_message(jsonb), private.valid_sequence_settings(uuid, jsonb),
  private.valid_campaign_audience(uuid, jsonb), private.generate_link_code() from public, anon, authenticated;

-- Links de entrada: p_input = {name, channelId, code?, tagId}.
create function public.save_entry_link(p_org uuid, p_id uuid, p_input jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_link public.entry_links;
  v_name text;
  v_channel uuid;
  v_code text;
  v_tag uuid;
  v_try int := 0;
begin
  if not public.has_role(p_org, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'invalid_input' using errcode = '22023'; end if;
  if jsonb_typeof(p_input -> 'name') is distinct from 'string' then raise exception 'invalid_name' using errcode = '22023'; end if;
  v_name := btrim(p_input ->> 'name');
  if char_length(v_name) not between 1 and 100 then raise exception 'invalid_name' using errcode = '22023'; end if;
  if not private.is_uuid_text(p_input -> 'channelId') then raise exception 'invalid_channel' using errcode = '22023'; end if;
  v_channel := (p_input ->> 'channelId')::uuid;
  if not exists (select 1 from public.channels where id = v_channel and organization_id = p_org
      and type in ('instagram', 'simulator')) then
    raise exception 'invalid_channel' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_input -> 'code'), 'null') <> 'null' then
    if jsonb_typeof(p_input -> 'code') <> 'string' or (p_input ->> 'code') !~ '^[a-z0-9_-]{3,40}$' then
      raise exception 'invalid_code' using errcode = '22023';
    end if;
    v_code := p_input ->> 'code';
  end if;
  if coalesce(jsonb_typeof(p_input -> 'tagId'), 'null') <> 'null' then
    if not private.is_uuid_text(p_input -> 'tagId') then raise exception 'invalid_tag' using errcode = '22023'; end if;
    v_tag := (p_input ->> 'tagId')::uuid;
    if not exists (select 1 from public.tags where id = v_tag and organization_id = p_org) then
      raise exception 'invalid_tag' using errcode = '22023';
    end if;
  end if;

  if v_id is not null then
    select * into v_link from public.entry_links where id = v_id and organization_id = p_org for update;
    if not found then raise exception 'entry_link_not_found' using errcode = 'P0002'; end if;
    if v_link.channel_id <> v_channel then raise exception 'channel_immutable' using errcode = '22023'; end if;
    v_code := coalesce(v_code, v_link.code);
  elsif v_code is null then
    loop
      v_try := v_try + 1;
      v_code := private.generate_link_code();
      exit when not exists (select 1 from public.entry_links where channel_id = v_channel and code = v_code);
      if v_try >= 10 then raise exception 'code_generation_failed' using errcode = '22023'; end if;
    end loop;
  end if;

  begin
    if v_id is null then
      insert into public.entry_links (organization_id, name, channel_id, code, tag_id)
        values (p_org, v_name, v_channel, v_code, v_tag)
        returning id into v_id;
    else
      update public.entry_links set name = v_name, code = v_code, tag_id = v_tag where id = v_id;
    end if;
  exception when unique_violation then
    raise exception 'code_taken' using errcode = '22023';
  end;
  return v_id;
end $$;

create function public.archive_entry_link(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_link public.entry_links;
begin
  select * into v_link from public.entry_links where id = p_id and public.is_member(organization_id) for update;
  if not found then raise exception 'entry_link_not_found' using errcode = 'P0002'; end if;
  if not public.has_role(v_link.organization_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.entry_links set status = 'archived' where id = p_id;
end $$;

-- Sequências: p_steps = [{id?, delayMinutes, window, message}] na ordem; posições 1..n.
-- Passos ausentes são apagados; os que já têm entregas ficam como removidos (removed_at, sem posição).
create function public.save_sequence(p_org uuid, p_id uuid, p_name text, p_settings jsonb, p_steps jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_name text := btrim(coalesce(p_name, ''));
  s jsonb;
  v_pos bigint;
  v_sid uuid;
  v_ids uuid[] := '{}';
begin
  if not public.has_role(p_org, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if char_length(v_name) not between 1 and 100 then raise exception 'invalid_name' using errcode = '22023'; end if;
  if not private.valid_sequence_settings(p_org, p_settings) then
    raise exception 'invalid_settings' using errcode = '22023';
  end if;
  if jsonb_typeof(p_steps) is distinct from 'array' then raise exception 'invalid_steps' using errcode = '22023'; end if;
  if v_id is not null then
    perform 1 from public.sequences where id = v_id and organization_id = p_org for update;
    if not found then raise exception 'sequence_not_found' using errcode = 'P0002'; end if;
  end if;

  for s in select e from jsonb_array_elements(p_steps) e loop
    if jsonb_typeof(s) <> 'object' or not private.is_int_between(s -> 'delayMinutes', 1, 43200)
       or not private.valid_send_window(s -> 'window') or not private.valid_outreach_message(s -> 'message') then
      raise exception 'invalid_step' using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(s -> 'id'), 'null') <> 'null' then
      if not private.is_uuid_text(s -> 'id') then raise exception 'invalid_step_id' using errcode = '22023'; end if;
      v_sid := (s ->> 'id')::uuid;
      if v_sid = any (v_ids) or v_id is null or not exists (select 1 from public.sequence_steps
          where id = v_sid and sequence_id = v_id and organization_id = p_org and removed_at is null) then
        raise exception 'invalid_step_id' using errcode = '22023';
      end if;
      v_ids := v_ids || v_sid;
    end if;
  end loop;

  if v_id is null then
    insert into public.sequences (organization_id, name, settings) values (p_org, v_name, p_settings)
      returning id into v_id;
  else
    update public.sequences set name = v_name, settings = p_settings where id = v_id;
  end if;

  update public.sequence_steps st set removed_at = now(), position = null
    where st.sequence_id = v_id and st.removed_at is null and not (st.id = any (v_ids))
      and exists (select 1 from public.outreach_deliveries d where d.step_id = st.id);
  delete from public.sequence_steps
    where sequence_id = v_id and removed_at is null and not (id = any (v_ids));

  for s, v_pos in select e, o from jsonb_array_elements(p_steps) with ordinality as t(e, o) loop
    if coalesce(jsonb_typeof(s -> 'id'), 'null') <> 'null' then
      update public.sequence_steps set position = v_pos, delay_minutes = (s ->> 'delayMinutes')::int,
        "window" = nullif(s -> 'window', 'null'::jsonb), message = s -> 'message'
        where id = (s ->> 'id')::uuid;
    else
      insert into public.sequence_steps (organization_id, sequence_id, position, delay_minutes, "window", message)
        values (p_org, v_id, v_pos, (s ->> 'delayMinutes')::int, nullif(s -> 'window', 'null'::jsonb), s -> 'message');
    end if;
  end loop;
  return v_id;
end $$;

create function public.set_sequence_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_seq public.sequences;
begin
  select * into v_seq from public.sequences where id = p_id and public.is_member(organization_id) for update;
  if not found then raise exception 'sequence_not_found' using errcode = 'P0002'; end if;
  if not public.has_role(v_seq.organization_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('active', 'paused') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_status = 'active' and not exists (select 1 from public.sequence_steps where sequence_id = p_id and removed_at is null) then
    raise exception 'no_steps' using errcode = '22023';
  end if;
  update public.sequences set status = p_status where id = p_id and status <> p_status;
end $$;

create function public.delete_sequence(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_seq public.sequences;
begin
  select * into v_seq from public.sequences where id = p_id and public.is_member(organization_id) for update;
  if not found then raise exception 'sequence_not_found' using errcode = 'P0002'; end if;
  if not public.has_role(v_seq.organization_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.outreach_deliveries d set status = 'cancelled', reason = 'sequence_deleted', claim_token = null,
      claimed_until = null
    where d.status = 'pending' and d.enrollment_id in (select e.id from public.sequence_enrollments e where e.sequence_id = p_id);
  delete from public.sequences where id = p_id;
end $$;

-- Campanhas: editáveis e excluíveis só em rascunho.
create function public.save_campaign(p_org uuid, p_id uuid, p_name text, p_audience jsonb, p_message jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_id; v_name text := btrim(coalesce(p_name, '')); v_status text;
begin
  if not public.has_role(p_org, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if char_length(v_name) not between 1 and 100 then raise exception 'invalid_name' using errcode = '22023'; end if;
  if v_id is not null then
    select status into v_status from public.campaigns where id = v_id and organization_id = p_org for update;
    if not found then raise exception 'campaign_not_found' using errcode = 'P0002'; end if;
    if v_status <> 'draft' then raise exception 'campaign_not_draft' using errcode = '22023'; end if;
  end if;
  if not private.valid_campaign_audience(p_org, p_audience) then raise exception 'invalid_audience' using errcode = '22023'; end if;
  if not private.valid_outreach_message(p_message) then raise exception 'invalid_message' using errcode = '22023'; end if;
  if v_id is null then
    insert into public.campaigns (organization_id, name, audience, message) values (p_org, v_name, p_audience, p_message)
      returning id into v_id;
  else
    update public.campaigns set name = v_name, audience = p_audience, message = p_message where id = v_id;
  end if;
  return v_id;
end $$;

create function public.delete_campaign(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_campaign public.campaigns;
begin
  select * into v_campaign from public.campaigns where id = p_id and public.is_member(organization_id) for update;
  if not found then raise exception 'campaign_not_found' using errcode = 'P0002'; end if;
  if not public.has_role(v_campaign.organization_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_campaign.status <> 'draft' then raise exception 'campaign_not_draft' using errcode = '22023'; end if;
  delete from public.campaigns where id = p_id;
end $$;

-- Usuário do Instagram: informado pelo admin (Canais) ou gravado pelo serviço após a verificação da conta.
create function private.normalize_instagram_username(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(lower(regexp_replace(btrim(coalesce(p, '')), '^@', '')), '')
$$;
revoke all on function private.normalize_instagram_username(text) from public, anon, authenticated;

create function public.set_instagram_username(p_channel uuid, p_username text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_channel public.channels; v_username text := private.normalize_instagram_username(p_username);
begin
  select * into v_channel from public.channels where id = p_channel and public.is_member(organization_id) for update;
  if not found then raise exception 'channel_not_found' using errcode = 'P0002'; end if;
  if not public.has_role(v_channel.organization_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_channel.type <> 'instagram' then raise exception 'not_instagram' using errcode = '22023'; end if;
  if v_username is null or v_username !~ '^[a-z0-9._]{1,30}$' then
    raise exception 'invalid_username' using errcode = '22023';
  end if;
  update public.channels set instagram_username = v_username where id = p_channel;
end $$;

create function public.record_instagram_username(p_channel_id uuid, p_username text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_username text := private.normalize_instagram_username(p_username);
begin
  if v_username is null or v_username !~ '^[a-z0-9._]{1,30}$' then
    raise exception 'invalid_username' using errcode = '22023';
  end if;
  update public.channels set instagram_username = v_username where id = p_channel_id and type = 'instagram';
  if not found then raise exception 'channel_not_found' using errcode = 'P0002'; end if;
end $$;

revoke all on function public.save_entry_link(uuid, uuid, jsonb), public.archive_entry_link(uuid),
  public.save_sequence(uuid, uuid, text, jsonb, jsonb), public.set_sequence_status(uuid, text),
  public.delete_sequence(uuid), public.save_campaign(uuid, uuid, text, jsonb, jsonb), public.delete_campaign(uuid),
  public.set_instagram_username(uuid, text) from public, anon;
grant execute on function public.save_entry_link(uuid, uuid, jsonb), public.archive_entry_link(uuid),
  public.save_sequence(uuid, uuid, text, jsonb, jsonb), public.set_sequence_status(uuid, text),
  public.delete_sequence(uuid), public.save_campaign(uuid, uuid, text, jsonb, jsonb), public.delete_campaign(uuid),
  public.set_instagram_username(uuid, text) to authenticated;
revoke all on function public.record_instagram_username(uuid, text) from public, anon, authenticated;
grant execute on function public.record_instagram_username(uuid, text) to service_role;
