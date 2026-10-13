-- Fase 7A: disparo de automações, prioridade sobre a IA, retomada por resposta/clique e cancelamento.

create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------- texto e palavras-chave
-- Espelha normalizeText do core: NFD + remoção de marcas + minúsculas + espaços colapsados + trim.
create function private.automation_normalize(p_text text) returns text
language sql stable set search_path = '' as $$
  select btrim(regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary,
    regexp_replace(normalize(coalesce(p_text, ''), NFD), '[̀-ͯ]', '', 'g'))), '\s+', ' ', 'g'));
$$;

-- Mesmas regras de matchKeyword: modos contains | equals | starts_with; palavras vazias ignoradas.
create function private.automation_keyword_matches(p_text text, p_config jsonb) returns boolean
language plpgsql stable set search_path = '' as $$
declare v_text text := private.automation_normalize(p_text); v_mode text := p_config ->> 'mode'; k text; v_kw text;
begin
  if v_text = '' or jsonb_typeof(p_config -> 'keywords') is distinct from 'array' then return false; end if;
  for k in select jsonb_array_elements_text(p_config -> 'keywords') loop
    v_kw := private.automation_normalize(k);
    continue when v_kw = '';
    if (v_mode = 'equals' and v_text = v_kw)
       or (v_mode = 'starts_with' and left(v_text, char_length(v_kw)) = v_kw)
       or (v_mode = 'contains' and strpos(v_text, v_kw) > 0) then
      return true;
    end if;
  end loop;
  return false;
end $$;

-- ---------------------------------------------------------------- payloads assinados
-- fa1.<run>.<node>.<option>.<hmac16>: HMAC-SHA256 (segredo do Vault) sobre <run>.<node>.<option>, hex com 16 caracteres.
create function private.automation_payload(p_run uuid, p_node uuid, p_option text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_body text; v_secret text;
begin
  if p_run is null or p_node is null or p_option is null or p_option !~ '^[a-z0-9]{1,12}$' then
    raise exception 'invalid payload' using errcode = '22023';
  end if;
  select s.decrypted_secret into v_secret
    from private.automation_secrets a join vault.decrypted_secrets s on s.id = a.payload_secret_id;
  if v_secret is null then raise exception 'payload secret missing' using errcode = 'P0002'; end if;
  v_body := p_run::text || '.' || p_node::text || '.' || p_option;
  return 'fa1.' || v_body || '.' || left(encode(extensions.hmac(v_body, v_secret, 'sha256'), 'hex'), 16);
end $$;

-- {runId, nodeId, optionId} ou null (formato inválido, adulterado ou assinado com outro segredo).
create function private.automation_verify_payload(p_payload text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_parts text[];
  v_uuid constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
  if p_payload is null or p_payload !~ ('^fa1\.' || v_uuid || '\.' || v_uuid || '\.[a-z0-9]{1,12}\.[0-9a-f]{16}$') then
    return null;
  end if;
  v_parts := string_to_array(p_payload, '.');
  -- compara a string inteira recalculada (uuid::text é canônico e minúsculo, como o formato exige)
  if private.automation_payload(v_parts[2]::uuid, v_parts[3]::uuid, v_parts[4]) is distinct from p_payload then
    return null;
  end if;
  return jsonb_build_object('runId', v_parts[2], 'nodeId', v_parts[3], 'optionId', v_parts[4]);
end $$;

-- ---------------------------------------------------------------- execuções
-- Cria a execução na versão corrente, no nó gatilho do grafo dessa versão (idempotente por evento).
create function private.automation_start_run(p_auto public.automations, p_event uuid, p_conv uuid, p_contact uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_trigger uuid; v_run uuid;
begin
  select (n ->> 'id')::uuid into v_trigger
    from public.automation_versions v, jsonb_array_elements(v.graph -> 'nodes') n
    where v.automation_id = p_auto.id and v.version = p_auto.current_version and n ->> 'type' = 'trigger'
    limit 1;
  if v_trigger is null then return null; end if;
  insert into public.automation_runs (organization_id, automation_id, trigger_event_id, conversation_id, contact_id,
      status, current_node_id, resume_at, version)
    values (p_auto.organization_id, p_auto.id, p_event, p_conv, p_contact, 'pending', v_trigger, now(),
      p_auto.current_version)
    on conflict (automation_id, trigger_event_id) do nothing
    returning id into v_run;
  return v_run;
end $$;

-- Vincula a execução à conversa quando ela não tem execução ativa; a IA perde a tarefa pendente.
create function private.automation_link_run(p_conv uuid, p_run uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_rows int;
begin
  update public.conversations c set automation_run_id = p_run
    where c.id = p_conv and c.automation_run_id is distinct from p_run
      and not exists (select 1 from public.automation_runs r where r.id = c.automation_run_id
        and r.status in ('pending', 'running', 'waiting'));
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    update public.ai_jobs set state = 'cancelled', claim_token = null, claimed_until = null
      where conversation_id = p_conv and kind = 'reply' and state = 'pending';
  end if;
  return v_rows > 0;
end $$;

-- Cancela execuções pendentes/em espera da conversa e/ou do contato.
create function private.automation_cancel_runs(p_conv uuid, p_contact uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v_rows int;
begin
  update public.automation_runs set status = 'cancelled', claim_token = null, claimed_until = null, resume_at = null
    where status in ('pending', 'waiting')
      and ((p_conv is not null and conversation_id = p_conv) or (p_contact is not null and contact_id = p_contact));
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

-- ---------------------------------------------------------------- ingestão com context
create function public.ingest_inbound_message(
  p_channel uuid,
  p_external_id text,
  p_sender_external_id text,
  p_sender_name text,
  p_text text,
  p_sent_at timestamptz,
  p_context jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_type public.channel_type;
  v_status public.channel_status;
  v_role text := auth.role();
  v_msg uuid;
  v_contact uuid;
  v_conv uuid;
  v_conv_status public.conversation_status;
  v_handler public.handler_type;
  v_name text := nullif(btrim(coalesce(p_sender_name, '')), '');
  v_privileged boolean;
  v_at timestamptz;
  v_context jsonb := coalesce(p_context, '{}'::jsonb);
begin
  -- 1. canal
  select organization_id, type, status into v_org, v_type, v_status
  from public.channels where id = p_channel;
  if v_org is null or v_status is distinct from 'active' then
    -- P0002 antes da autorizacao e intencional: o UUID do canal precisa ser adivinhado
    raise exception 'channel not found or inactive' using errcode = 'P0002';
  end if;

  -- 2. autorizacao. Sem role no JWT so vale para conexao direta do banco (sessao postgres/
  -- supabase_admin sem SET ROLE); qualquer outro caso sem role falha.
  v_privileged := coalesce(v_role = 'service_role', false)
    or (v_role is null
        and session_user in ('postgres', 'supabase_admin')
        and current_setting('role') in ('none', 'postgres', 'supabase_admin'));
  if not (
    v_privileged
    or coalesce(v_role = 'authenticated' and v_type = 'simulator' and public.has_role(v_org, 'admin'), false)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- instante efetivo: nunca no futuro; usuarios autenticados nao escolhem o horario
  v_at := case when v_privileged then least(p_sent_at, now()) else now() end;

  -- 3. validacao
  if p_text is null or p_text !~ '[^[:space:]]' or char_length(p_text) > 4096
     or p_external_id is null or btrim(p_external_id) = ''
     or p_sender_external_id is null or btrim(p_sender_external_id) = ''
     or p_sent_at is null or jsonb_typeof(v_context) <> 'object' then
    raise exception 'invalid input' using errcode = '22023';
  end if;

  -- serializa duplicatas e primeiras mensagens simultaneas do mesmo remetente
  perform pg_advisory_xact_lock(hashtextextended('ingest:msg:' || p_channel::text || ':' || p_external_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('ingest:sender:' || v_org::text || ':' || v_type::text || ':' || p_sender_external_id, 0));

  -- duplicada: sem nenhum efeito
  select id into v_msg from public.messages
  where channel_id = p_channel and external_id = p_external_id;
  if v_msg is not null then
    return v_msg;
  end if;

  -- 4. contato
  if v_type = 'instagram' then
    select id into v_contact from public.contacts
    where organization_id = v_org and instagram_id = p_sender_external_id;
  else
    if v_type = 'whatsapp' then
      select id into v_contact from public.contacts
      where organization_id = v_org and whatsapp_id = p_sender_external_id;
    end if;
    if v_contact is null then
      select id into v_contact from public.contacts
      where organization_id = v_org and phone = p_sender_external_id
      order by created_at limit 1;
    end if;
  end if;
  if v_contact is null then
    insert into public.contacts (organization_id, name, phone, source, whatsapp_id, instagram_id)
    values (
      v_org,
      v_name,
      case when v_type = 'instagram' then null else p_sender_external_id end,
      v_type::text::public.contact_source,
      case when v_type = 'whatsapp' then p_sender_external_id end,
      case when v_type = 'instagram' then p_sender_external_id end
    )
    returning id into v_contact;
  end if;

  -- 5. conversa (a mais recente do contato no canal)
  select case when exists (
           select 1 from public.ai_agents
           where organization_id = v_org and is_active and auto_reply
         ) then 'ai' else 'human' end::public.handler_type
  into v_handler;

  select id, status into v_conv, v_conv_status from public.conversations
  where organization_id = v_org and contact_id = v_contact and channel_id = p_channel
  order by created_at desc, id desc limit 1
  for update;

  if v_conv is null then
    insert into public.conversations (organization_id, contact_id, channel_id, status, handled_by, last_message_at)
    values (v_org, v_contact, p_channel, 'open', v_handler, v_at)
    returning id into v_conv;
  elsif v_conv_status = 'closed' then
    update public.conversations
    set status = 'open', assigned_to = null, closed_at = null, handled_by = v_handler
    where id = v_conv;
  end if;

  -- 6. mensagem (created_at = p_sent_at; o gatilho move last_message_at para frente). O context vai
  -- na inserção para que os gatilhos AFTER INSERT (automações) o enxerguem.
  insert into public.messages (organization_id, conversation_id, channel_id, direction,
    sender_type, content, status, external_id, created_at, context)
  values (v_org, v_conv, p_channel, 'inbound', 'contact', p_text, 'delivered', p_external_id, v_at, v_context)
  on conflict (channel_id, external_id) do nothing
  returning id into v_msg;
  if v_msg is null then
    select id into v_msg from public.messages
    where channel_id = p_channel and external_id = p_external_id;
    return v_msg;
  end if;

  -- 7. interacao do contato (apenas para frente)
  update public.contacts
  set last_interaction_at = greatest(coalesce(last_interaction_at, v_at), v_at),
      name = coalesce(name, v_name),
      whatsapp_id = case when v_type = 'whatsapp' then coalesce(whatsapp_id, p_sender_external_id) else whatsapp_id end
  where id = v_contact;

  return v_msg;
end $$;

-- p_context sem default: com default, a chamada de 6 argumentos ficaria ambígua entre as duas variantes.
revoke all on function public.ingest_inbound_message(uuid, text, text, text, text, timestamptz, jsonb) from public, anon;
grant execute on function public.ingest_inbound_message(uuid, text, text, text, text, timestamptz, jsonb) to authenticated, service_role;

create or replace function public.ingest_inbound_message(
  p_channel uuid,
  p_external_id text,
  p_sender_external_id text,
  p_sender_name text,
  p_text text,
  p_sent_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.ingest_inbound_message(p_channel, p_external_id, p_sender_external_id, p_sender_name, p_text,
    p_sent_at, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------- mensagem recebida
-- Ordem: (1) execução aguardando resposta/clique -> retoma; (2) sem execução ativa -> automação casada
-- -> nova execução; (3) senão, a tarefa da IA (ai_enqueue_reply) segue como antes.
create function private.automation_inbound() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  conv public.conversations;
  run public.automation_runs;
  auto public.automations;
  v_verified jsonb;
  v_option text;
  v_first boolean;
  v_event uuid;
  v_run uuid;
begin
  select * into conv from public.conversations
    where id = new.conversation_id and organization_id = new.organization_id for update;
  if not found then return null; end if;

  -- 1. retomada: só a primeira resposta (input ainda nulo); as seguintes não sobrescrevem
  select r.* into run from public.automation_runs r
    where r.organization_id = conv.organization_id and r.conversation_id = conv.id
      and r.status = 'waiting' and r.waiting_for = 'reply' and r.input is null
    order by (r.id = conv.automation_run_id) desc nulls last, r.created_at desc, r.id
    limit 1
    for update;
  if found then
    v_verified := private.automation_verify_payload(new.context ->> 'payload');
    if v_verified ->> 'runId' = run.id::text and v_verified ->> 'nodeId' = run.wait_node_id::text then
      v_option := v_verified ->> 'optionId';
    end if;
    update public.automation_runs
      set input = jsonb_build_object('optionId', v_option, 'text', new.content), resume_at = now()
      where id = run.id;
    perform private.automation_link_run(conv.id, run.id);
    return null;
  end if;

  -- 2. conversa já em automação: nada a fazer (e a IA não é enfileirada)
  if exists (select 1 from public.automation_runs r
      where r.organization_id = conv.organization_id
        and (r.conversation_id = conv.id or r.id = conv.automation_run_id)
        and r.status in ('pending', 'running', 'waiting')) then
    return null;
  end if;

  v_first := not exists (select 1 from public.messages m
    where m.conversation_id = conv.id and m.id <> new.id and m.direction = 'inbound'
      and m.sender_type = 'contact' and not m.is_internal_note);

  select a.* into auto
    from public.automations a
    join public.automation_versions v on v.automation_id = a.id and v.version = a.current_version
    where a.organization_id = conv.organization_id and a.status = 'active'
      and (
        (v.trigger_type = 'keyword_detected' and private.automation_keyword_matches(new.content, v.trigger_config))
        or (v.trigger_type = 'message_received'
            and (v.trigger_config -> 'firstMessageOnly' is distinct from 'true'::jsonb or v_first))
        or (v.trigger_type = 'instagram_story'
            and new.context ->> 'origin' in ('story_reply', 'story_mention')
            and v.trigger_config ->> 'channelId' = new.channel_id::text)
      )
    order by a.activated_at nulls last, a.id
    limit 1;
  if not found then return null; end if;

  insert into public.events (organization_id, type, conversation_id, contact_id, actor_type, actor_id, payload)
    values (conv.organization_id, 'automation_trigger', conv.id, conv.contact_id, 'system', null,
      jsonb_build_object('automation_id', auto.id, 'message_id', new.id))
    returning id into v_event;
  v_run := private.automation_start_run(auto, v_event, conv.id, conv.contact_id);
  if v_run is not null then
    perform private.automation_link_run(conv.id, v_run);
  end if;
  return null;
end $$;

-- O nome "aa_..." é proposital: gatilhos do mesmo evento disparam em ordem alfabética, e este precisa
-- rodar antes de ai_enqueue_reply para que a IA já veja o vínculo da conversa com a execução.
-- Só mensagens do contato: mensagens de automação (sender_type='automation') nunca disparam (anti-loop).
create trigger aa_automation_inbound after insert on public.messages
  for each row when (new.direction = 'inbound' and new.sender_type = 'contact' and not new.is_internal_note)
  execute function private.automation_inbound();

-- ---------------------------------------------------------------- IA: prioridade da automação
create or replace function public.ai_enqueue_reply() returns trigger
language plpgsql security definer set search_path = '' as $$
declare conv public.conversations;
begin
  select * into conv from public.conversations where id = new.conversation_id and organization_id = new.organization_id;
  -- conversa em automação (execução pending/running/waiting): a IA não é enfileirada
  if conv.automation_run_id is not null and exists (select 1 from public.automation_runs r
      where r.id = conv.automation_run_id and r.status in ('pending', 'running', 'waiting')) then
    return null;
  end if;
  if private.ai_reply_eligible(conv) then
    insert into public.ai_jobs (organization_id, kind, conversation_id, run_after)
      values (conv.organization_id, 'reply', conv.id, now() + interval '4 seconds')
      on conflict (conversation_id) where kind = 'reply' and state = 'pending'
      do update set run_after = now() + interval '4 seconds';
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------- evento tag_added
create function public.trg_contact_tags_emit_tag_added() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.emit_event(new.organization_id, 'tag_added', null, new.contact_id, null,
    jsonb_build_object('tag_id', new.tag_id));
  return null;
end $$;
revoke all on function public.trg_contact_tags_emit_tag_added() from public, anon, authenticated;

create trigger contact_tags_emit_tag_added after insert on public.contact_tags
  for each row execute function public.trg_contact_tags_emit_tag_added();

-- save_contact: tags passam a ser sincronizadas por diferença (antes: apaga todas e reinsere), para que
-- salvar o contato sem mudar as tags não emita tag_added nem dispare automações.
create or replace function public.save_contact(
  p_org uuid,
  p_contact_id uuid,
  p_data jsonb,
  p_tag_ids uuid[],
  p_custom_fields jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_data jsonb := coalesce(p_data, '{}'::jsonb);
begin
  if p_contact_id is null then
    insert into public.contacts (organization_id, name, phone, email, status, assigned_to, lead_score)
    values (
      p_org,
      v_data ->> 'name',
      v_data ->> 'phone',
      v_data ->> 'email',
      coalesce((v_data ->> 'status')::public.contact_status, 'lead'),
      (v_data ->> 'assigned_to')::uuid,
      coalesce((v_data ->> 'lead_score')::int, 0)
    )
    returning id into v_id;
  else
    update public.contacts c set
      name = case when v_data ? 'name' then v_data ->> 'name' else c.name end,
      phone = case when v_data ? 'phone' then v_data ->> 'phone' else c.phone end,
      email = case when v_data ? 'email' then v_data ->> 'email' else c.email end,
      status = case when v_data ? 'status' then (v_data ->> 'status')::public.contact_status else c.status end,
      assigned_to = case when v_data ? 'assigned_to' then (v_data ->> 'assigned_to')::uuid else c.assigned_to end,
      lead_score = case when v_data ? 'lead_score' then (v_data ->> 'lead_score')::int else c.lead_score end
    where c.id = p_contact_id and c.organization_id = p_org
    returning c.id into v_id;
    if v_id is null then
      raise exception 'contact not found' using errcode = 'P0002';
    end if;
  end if;

  if p_tag_ids is not null then
    delete from public.contact_tags
      where contact_id = v_id and organization_id = p_org and not (tag_id = any (p_tag_ids));
    if cardinality(p_tag_ids) > 0 then
      insert into public.contact_tags (organization_id, contact_id, tag_id)
      select p_org, v_id, t from unnest(p_tag_ids) as t
        where not exists (select 1 from public.contact_tags ct where ct.contact_id = v_id and ct.tag_id = t)
        group by t;
    end if;
  end if;

  if p_custom_fields is not null then
    delete from public.contact_custom_fields where contact_id = v_id and organization_id = p_org;
    if jsonb_array_length(p_custom_fields) > 0 then
      insert into public.contact_custom_fields (organization_id, contact_id, key, value)
      select p_org, v_id, f ->> 'key', f ->> 'value'
      from jsonb_array_elements(p_custom_fields) f;
    end if;
  end if;

  return v_id;
end $$;

-- ---------------------------------------------------------------- eventos de CRM
-- contact_created; tag_added (config.tagId, null = qualquer); stage_changed a partir de deal_created
-- (etapa inicial) e deal_stage_changed (etapa de destino) (config.stageId, null = qualquer).
-- Todas as automações ativas da organização que casarem ganham execução; a conversa aberta mais
-- recente do contato é ligada (e vinculada se não tiver execução ativa).
create function private.automation_crm_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_type public.automation_trigger_type;
  v_key text;
  v_value text;
  v_conv uuid;
  v_run uuid;
  auto public.automations;
begin
  if new.contact_id is null then return null; end if;
  case new.type
    when 'contact_created' then v_type := 'contact_created';
    when 'tag_added' then v_type := 'tag_added'; v_key := 'tagId'; v_value := new.payload ->> 'tag_id';
    when 'deal_created' then v_type := 'stage_changed'; v_key := 'stageId'; v_value := new.payload ->> 'stage_id';
    when 'deal_stage_changed' then v_type := 'stage_changed'; v_key := 'stageId'; v_value := new.payload ->> 'to_stage_id';
    else return null;
  end case;
  if not exists (select 1 from public.automations a
      where a.organization_id = new.organization_id and a.status = 'active' and a.trigger_type = v_type) then
    return null;
  end if;

  select c.id into v_conv from public.conversations c
    where c.organization_id = new.organization_id and c.contact_id = new.contact_id and c.status <> 'closed'
    order by c.last_message_at desc nulls last, c.created_at desc, c.id desc
    limit 1;

  for auto in
    select a.* from public.automations a
      join public.automation_versions v on v.automation_id = a.id and v.version = a.current_version
      where a.organization_id = new.organization_id and a.status = 'active' and v.trigger_type = v_type
        and (v_key is null or coalesce(v.trigger_config -> v_key, 'null'::jsonb) = 'null'::jsonb
             or v.trigger_config ->> v_key = v_value)
      order by a.activated_at nulls last, a.id
  loop
    v_run := private.automation_start_run(auto, new.id, v_conv, new.contact_id);
    if v_run is not null and v_conv is not null then
      perform private.automation_link_run(v_conv, v_run);
    end if;
  end loop;
  return null;
end $$;

create trigger automation_crm_event after insert on public.events
  for each row when (new.type in ('contact_created', 'tag_added', 'deal_created', 'deal_stage_changed'))
  execute function private.automation_crm_event();

-- ---------------------------------------------------------------- cancelamento
-- Conversa fechada: cancela execuções pending/waiting e limpa o vínculo.
create function private.automation_conversation_closed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.automation_cancel_runs(new.id, null);
  new.automation_run_id := null;
  return new;
end $$;

create trigger automation_conversation_closed before update of status on public.conversations
  for each row when (new.status = 'closed' and old.status is distinct from 'closed')
  execute function private.automation_conversation_closed();

-- Conversa ou contato excluídos: as execuções ficam registradas como canceladas.
create function private.automation_conversation_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.automation_cancel_runs(old.id, null);
  return old;
end $$;

create trigger automation_conversation_deleted before delete on public.conversations
  for each row execute function private.automation_conversation_deleted();

create function private.automation_contact_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.automation_cancel_runs(null, old.id);
  return old;
end $$;

create trigger automation_contact_deleted before delete on public.contacts
  for each row execute function private.automation_contact_deleted();

-- ---------------------------------------------------------------- Parar automação (agent+)
create function public.stop_automation(p_conversation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare conv public.conversations; v_rows int; v_actor text;
begin
  select * into conv from public.conversations where id = p_conversation for update;
  if not found or not public.has_role(conv.organization_id, 'agent') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.automation_runs set status = 'cancelled', claim_token = null, claimed_until = null, resume_at = null
    where organization_id = conv.organization_id and conversation_id = conv.id
      and (status in ('pending', 'waiting') or (id = conv.automation_run_id and status = 'running'));
  get diagnostics v_rows = row_count;
  update public.conversations set automation_run_id = null where id = conv.id and automation_run_id is not null;
  if v_rows = 0 then return; end if;

  select coalesce(nullif(btrim(full_name), ''), 'Alguém') into v_actor from public.profiles where id = auth.uid();
  insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, sender_user_id,
      content, status)
    values (conv.organization_id, conv.id, conv.channel_id, 'outbound', 'system', auth.uid(),
      'Automação interrompida por ' || coalesce(v_actor, 'Alguém'), 'delivered');
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function
  private.automation_normalize(text),
  private.automation_keyword_matches(text, jsonb),
  private.automation_payload(uuid, uuid, text),
  private.automation_verify_payload(text),
  private.automation_start_run(public.automations, uuid, uuid, uuid),
  private.automation_link_run(uuid, uuid),
  private.automation_cancel_runs(uuid, uuid),
  private.automation_inbound(),
  private.automation_crm_event(),
  private.automation_conversation_closed(),
  private.automation_conversation_deleted(),
  private.automation_contact_deleted()
  from public, anon, authenticated;
revoke all on function public.stop_automation(uuid) from public, anon;
grant execute on function public.stop_automation(uuid) to authenticated;
