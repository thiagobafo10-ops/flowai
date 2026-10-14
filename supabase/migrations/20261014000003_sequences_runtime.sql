-- Fase 7B: sequências em execução.
-- * private.next_send_time / private.is_exit_word: espelham nextSendTime / isExitWord do core (packages/core/src/growth).
-- * Inscrição (private.sequence_enroll) e remoção (private.sequence_remove); RPCs da ficha (agent+):
--   enroll_contact_in_sequence / remove_contact_from_sequence; efeitos sequence_enroll / sequence_remove em
--   apply_automation_step (automation_validate_step e automation_apply_step redefinidos sobre 000004/000009).
-- * Agendamento: private.sequence_schedule_next(p_enrollment) cria a entrega do próximo passo vivo (ou conclui a
--   inscrição); chamado pela inscrição, pela conclusão da entrega (Task 7), pela retomada e pela edição da sequência.
-- * Saída por mensagem do contato: palavra de saída (exit_word, com nota) ou qualquer resposta (exitOnReply → replied).
-- * Pausa (entregas pendentes → cancelled 'paused') e retomada (passo atual reagendado a partir de agora).
-- * Contato excluído: sai de todas as sequências (entregas pendentes → cancelled 'contact_deleted').
--
-- Modelo de posição: a inscrição recebe os passos vivos em ordem de posição. O próximo passo é o passo vivo de menor
-- posição maior que a do último passo vivo que já teve entrega desta inscrição (entregas canceladas por pausa não
-- contam: o passo é reaproveitado na retomada). Passo removido (removed_at, sem posição) nunca é escolhido e suas
-- entregas não contam; assim a inscrição segue para o passo seguinte. current_position espelha a posição do passo
-- atual (pendente ou a reagendar).

-- ---------------------------------------------------------------- horário de envio
-- from + espera; se há janela e o resultado cai fora dela, vai para o próximo início permitido no fuso informado
-- (fim exclusivo; no máximo 8 dias à frente). Minutos locais truncados, como no core.
create function private.next_send_time(p_from timestamptz, p_delay_minutes int, p_window jsonb, p_tz text)
returns timestamptz
language plpgsql stable set search_path = '' as $$
declare
  t timestamptz := p_from + make_interval(mins => p_delay_minutes);
  v_local timestamp;
  v_start int;
  v_end int;
  v_minutes int;
  v_day date;
  k int;
begin
  if p_window is null or jsonb_typeof(p_window) = 'null' then return t; end if;
  v_start := split_part(p_window ->> 'start', ':', 1)::int * 60 + split_part(p_window ->> 'start', ':', 2)::int;
  v_end := split_part(p_window ->> 'end', ':', 1)::int * 60 + split_part(p_window ->> 'end', ':', 2)::int;
  v_local := t at time zone p_tz;
  v_minutes := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  if (p_window -> 'days') @> to_jsonb(extract(isodow from v_local)::int) and v_minutes >= v_start and v_minutes < v_end then
    return t;
  end if;
  for k in 0..8 loop
    v_day := v_local::date + k;
    continue when not (p_window -> 'days') @> to_jsonb(extract(isodow from v_day)::int);
    continue when k = 0 and v_minutes >= v_start; -- hoje já passou do início
    return (v_day + make_interval(mins => v_start)) at time zone p_tz;
  end loop;
  return t;
end $$;

-- ---------------------------------------------------------------- palavra de saída
-- A mensagem inteira, normalizada (automation_normalize = normalizeText) e sem pontuação/símbolos nas pontas, é igual
-- a uma das palavras (normalizadas do mesmo jeito).
create function private.exit_word_strip(p_text text) returns text
language sql stable set search_path = '' as $$
  select regexp_replace(private.automation_normalize(p_text), '^[^[:alnum:]]+|[^[:alnum:]]+$', '', 'g')
$$;

create function private.is_exit_word(p_text text, p_words jsonb) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(private.exit_word_strip(p_text) <> '' and jsonb_typeof(p_words) = 'array'
    and exists (select 1 from jsonb_array_elements(p_words) w
      where jsonb_typeof(w) = 'string' and private.exit_word_strip(w #>> '{}') = private.exit_word_strip(p_text)), false)
$$;

-- ---------------------------------------------------------------- agendamento
-- Conversa do contato nos canais dados pela regra da ingestão (private.inbound_conversation): a mais recente por
-- created_at desc, id desc (qualquer status; a ingestão reabre a fechada). Nula quando não há conversa.
create function private.sequence_conversation(p_org uuid, p_contact uuid, p_channels uuid[]) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.conversations c
    where c.organization_id = p_org and c.contact_id = p_contact and c.channel_id = any (p_channels)
    order by c.created_at desc, c.id desc limit 1
$$;

-- Cria a entrega do próximo passo da inscrição ativa (run_after a partir de agora) ou a marca completed.
-- Idempotente: com entrega pending/sending nada muda. Sequência pausada: só posiciona (a retomada agenda).
create function private.sequence_schedule_next(p_enrollment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  en public.sequence_enrollments;
  v_seq_status text;
  st public.sequence_steps;
  v_from int;
  v_tz text;
  v_at timestamptz;
  v_conv uuid;
begin
  select * into en from public.sequence_enrollments where id = p_enrollment for update;
  if not found or en.status <> 'active' then return; end if;
  if exists (select 1 from public.outreach_deliveries d
      where d.enrollment_id = en.id and d.status in ('pending', 'sending')) then
    return;
  end if;
  select status into v_seq_status from public.sequences where id = en.sequence_id;

  select coalesce(max(s.position), 0) into v_from
    from public.outreach_deliveries d join public.sequence_steps s on s.id = d.step_id
    where d.enrollment_id = en.id and s.removed_at is null
      and not (d.status = 'cancelled' and d.reason is not distinct from 'paused');
  select * into st from public.sequence_steps
    where sequence_id = en.sequence_id and removed_at is null and position > v_from
    order by position limit 1;
  if not found then
    update public.sequence_enrollments set status = 'completed', next_send_at = null where id = en.id;
    return;
  end if;
  if v_seq_status is distinct from 'active' then
    update public.sequence_enrollments set current_position = st.position, next_send_at = null where id = en.id;
    return;
  end if;

  select o.timezone into v_tz from public.organizations o where o.id = en.organization_id;
  v_at := private.next_send_time(now(), st.delay_minutes, st."window", v_tz);
  -- sem conversa o envio dá no_conversation
  v_conv := private.sequence_conversation(en.organization_id, en.contact_id, array[en.channel_id]);
  -- a entrega cancelada pela pausa é reaproveitada (uma entrega por inscrição e passo)
  insert into public.outreach_deliveries (organization_id, source, enrollment_id, step_id, contact_id, channel_id,
      conversation_id, run_after)
    values (en.organization_id, 'sequence', en.id, st.id, en.contact_id, en.channel_id, v_conv, v_at)
    on conflict (enrollment_id, step_id) do update
      set status = 'pending', reason = null, run_after = excluded.run_after, conversation_id = excluded.conversation_id,
        postponements = 0, attempts = 0, claim_token = null, claimed_until = null, message_id = null, intent_id = null
      where public.outreach_deliveries.status = 'cancelled' and public.outreach_deliveries.reason = 'paused';
  update public.sequence_enrollments set current_position = st.position, next_send_at = v_at where id = en.id;
end $$;

-- ---------------------------------------------------------------- inscrição e saída
-- p_actor = actor_type do evento de duplicidade ('user' usa auth.uid() como actor_id).
-- Erros 22023: sequence_not_active (inexistente, rascunho ou pausada), invalid_contact (outra organização),
-- invalid_channel (nenhum canal da sequência existe mais).
-- Canal: o da conversa escolhida por private.sequence_conversation entre os canais da sequência (mesma regra do
-- agendamento); sem conversa, o primeiro canal existente da sequência.
-- Retorna a inscrição criada ou null quando o contato já está ativo nela (evento sequence_enroll_ignored).
create function private.sequence_enroll(p_sequence uuid, p_contact uuid, p_actor text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  seq public.sequences;
  v_channel uuid;
  v_id uuid;
begin
  if p_actor is null or p_actor not in ('user', 'automation', 'system') then
    raise exception 'invalid_actor' using errcode = '22023';
  end if;
  -- trava compartilhada: a sequência não muda de status no meio da inscrição
  select * into seq from public.sequences where id = p_sequence for share;
  if not found or seq.status <> 'active' then raise exception 'sequence_not_active' using errcode = '22023'; end if;
  if not exists (select 1 from public.contacts where id = p_contact and organization_id = seq.organization_id) then
    raise exception 'invalid_contact' using errcode = '22023';
  end if;

  select c.channel_id into v_channel from public.conversations c
    where c.id = private.sequence_conversation(seq.organization_id, p_contact,
      array(select x::uuid from jsonb_array_elements_text(seq.settings -> 'channelIds') x));
  if v_channel is null then
    select ch.id into v_channel
      from jsonb_array_elements_text(seq.settings -> 'channelIds') with ordinality s(id, ord)
      join public.channels ch on ch.id::text = s.id and ch.organization_id = seq.organization_id
      order by s.ord limit 1;
  end if;
  if v_channel is null then raise exception 'invalid_channel' using errcode = '22023'; end if;

  insert into public.sequence_enrollments (organization_id, sequence_id, contact_id, channel_id)
    values (seq.organization_id, seq.id, p_contact, v_channel)
    on conflict (sequence_id, contact_id) where status = 'active' do nothing
    returning id into v_id;
  if v_id is null then
    insert into public.events (organization_id, type, contact_id, actor_type, actor_id, payload)
      values (seq.organization_id, 'sequence_enroll_ignored', p_contact, p_actor,
        case when p_actor = 'user' then auth.uid() end, jsonb_build_object('sequence_id', seq.id));
    return null;
  end if;
  perform private.sequence_schedule_next(v_id);
  return v_id;
end $$;

-- Encerra a inscrição ativa (removed | exited) e cancela as entregas pendentes com o mesmo motivo (as em 'sending'
-- terminam no worker, que confere a inscrição).
create function private.sequence_end_enrollment(p_enrollment uuid, p_status text, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.sequence_enrollments set status = p_status, exit_reason = p_reason, next_send_at = null
    where id = p_enrollment and status = 'active';
  if not found then return false; end if;
  update public.outreach_deliveries set status = 'cancelled', reason = p_reason, claim_token = null, claimed_until = null
    where enrollment_id = p_enrollment and status = 'pending';
  return true;
end $$;

-- Remove o contato da sequência (sem inscrição ativa: nada a fazer). Retorna se havia inscrição ativa.
create function private.sequence_remove(p_sequence uuid, p_contact uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_reason is null or p_reason !~ '^[a-z0-9_]{1,64}$' then raise exception 'invalid_reason' using errcode = '22023'; end if;
  select id into v_id from public.sequence_enrollments
    where sequence_id = p_sequence and contact_id = p_contact and status = 'active' for update;
  if v_id is null then return false; end if;
  return private.sequence_end_enrollment(v_id, 'removed', p_reason);
end $$;

-- ---------------------------------------------------------------- ficha do contato (agent+)
-- Erros: P0002 sequence_not_found (inexistente ou de outra organização) | contact_not_found; 42501 sem papel agent;
-- 22023 sequence_not_active.
create function public.enroll_contact_in_sequence(p_sequence uuid, p_contact uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.sequences where id = p_sequence and public.is_member(organization_id);
  if v_org is null then raise exception 'sequence_not_found' using errcode = 'P0002'; end if;
  if not public.has_role(v_org, 'agent') then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.contacts where id = p_contact and organization_id = v_org) then
    raise exception 'contact_not_found' using errcode = 'P0002';
  end if;
  return private.sequence_enroll(p_sequence, p_contact, 'user');
end $$;

create function public.remove_contact_from_sequence(p_sequence uuid, p_contact uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.sequences where id = p_sequence and public.is_member(organization_id);
  if v_org is null then raise exception 'sequence_not_found' using errcode = 'P0002'; end if;
  if not public.has_role(v_org, 'agent') then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.contacts where id = p_contact and organization_id = v_org) then
    raise exception 'contact_not_found' using errcode = 'P0002';
  end if;
  perform private.sequence_remove(p_sequence, p_contact, 'removed');
end $$;

-- ---------------------------------------------------------------- saída por mensagem do contato
-- Inscrições ativas do contato cuja sequência inclui o canal da mensagem (qualquer canal de settings.channelIds, além
-- do canal da própria inscrição): palavra de saída (settings.exitWords; ausente = padrão
-- sair/parar/cancelar) → exited 'exit_word' com nota "Saiu da sequência {nome}"; senão exitOnReply → exited 'replied'.
-- O gatilho se chama sequence_exit_inbound para rodar depois (ordem alfabética) de aa_automation_inbound,
-- ai_enqueue_reply, ai_human_takes_over e messages_*: a mensagem dispara automação/IA normalmente e a nota de sistema
-- inserida aqui (outbound, system) não interfere nesses gatilhos da mesma mensagem.
create function private.sequence_exit_inbound() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_contact uuid;
  r record;
begin
  select contact_id into v_contact from public.conversations
    where id = new.conversation_id and organization_id = new.organization_id;
  if v_contact is null then return null; end if;
  for r in
    select e.id, s.name, s.settings from public.sequence_enrollments e join public.sequences s on s.id = e.sequence_id
      where e.organization_id = new.organization_id and e.contact_id = v_contact and e.status = 'active'
        and (e.channel_id = new.channel_id or coalesce(s.settings -> 'channelIds' ? new.channel_id::text, false))
      order by e.created_at, e.id
      for update of e
  loop
    if private.is_exit_word(new.content,
        case when r.settings ? 'exitWords' then r.settings -> 'exitWords' else '["sair","parar","cancelar"]'::jsonb end) then
      perform private.sequence_end_enrollment(r.id, 'exited', 'exit_word');
      insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content, status,
          created_at)
        values (new.organization_id, new.conversation_id, new.channel_id, 'outbound', 'system',
          'Saiu da sequência ' || r.name, 'delivered', greatest(now(), new.created_at + interval '1 millisecond'));
    elsif r.settings -> 'exitOnReply' = 'true'::jsonb then
      perform private.sequence_end_enrollment(r.id, 'exited', 'replied');
    end if;
  end loop;
  return null;
end $$;

create trigger sequence_exit_inbound after insert on public.messages
  for each row when (new.direction = 'inbound' and new.sender_type = 'contact' and not new.is_internal_note)
  execute function private.sequence_exit_inbound();

-- ---------------------------------------------------------------- contato excluído
-- Antes da exclusão (as inscrições saem em cascata e as entregas ficam com contato nulo): cancela as entregas
-- pendentes de sequência do contato.
create function private.sequence_contact_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  for v_id in select id from public.sequence_enrollments
      where organization_id = old.organization_id and contact_id = old.id and status = 'active'
      order by created_at, id for update loop
    perform private.sequence_end_enrollment(v_id, 'removed', 'contact_deleted');
  end loop;
  return old;
end $$;

create trigger sequence_contact_deleted before delete on public.contacts
  for each row execute function private.sequence_contact_deleted();

-- ---------------------------------------------------------------- pausa e retomada
-- Sobre 20261014000001: pausar cancela as entregas pendentes ('paused'); reativar agenda o passo atual a partir de
-- agora (a entrega cancelada pela pausa é reaproveitada).
create or replace function public.set_sequence_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_seq public.sequences; v_id uuid;
begin
  select * into v_seq from public.sequences where id = p_id and public.is_member(organization_id) for update;
  if not found then raise exception 'sequence_not_found' using errcode = 'P0002'; end if;
  if not public.has_role(v_seq.organization_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  -- draft → active; active ⇄ paused (rascunho nunca vai direto para pausada).
  if p_status is null or p_status not in ('active', 'paused') or (p_status = 'paused' and v_seq.status = 'draft') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_status = 'active' and not exists (select 1 from public.sequence_steps where sequence_id = p_id and removed_at is null) then
    raise exception 'no_steps' using errcode = '22023';
  end if;
  if v_seq.status = p_status then return; end if;
  update public.sequences set status = p_status where id = p_id;

  -- ordem de travas inscrição → entrega (a mesma da saída por mensagem e do agendamento)
  if p_status = 'paused' then
    update public.sequence_enrollments set next_send_at = null where sequence_id = p_id and status = 'active';
    update public.outreach_deliveries d set status = 'cancelled', reason = 'paused', claim_token = null, claimed_until = null
      where d.status = 'pending' and d.enrollment_id in (select e.id from public.sequence_enrollments e
        where e.sequence_id = p_id and e.status = 'active');
  elsif v_seq.status = 'paused' then
    for v_id in select id from public.sequence_enrollments where sequence_id = p_id and status = 'active'
        order by created_at, id loop
      perform private.sequence_schedule_next(v_id);
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------- edição da sequência
-- Sobre 20261014000001 (mesmo corpo, mais a trava das inscrições ativas logo após a da sequência): ao final, current_position acompanha a renumeração dos passos pendentes e as
-- inscrições ativas sem entrega em andamento (o passo pendente foi removido) seguem para o passo seguinte.
create or replace function public.save_sequence(p_org uuid, p_id uuid, p_name text, p_settings jsonb, p_steps jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_name text := btrim(coalesce(p_name, ''));
  s jsonb;
  v_pos bigint;
  v_sid uuid;
  v_ids uuid[] := '{}';
  v_status text;
  s_enrollment uuid;
begin
  if not public.has_role(p_org, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if char_length(v_name) not between 1 and 100 then raise exception 'invalid_name' using errcode = '22023'; end if;
  if not private.valid_sequence_settings(p_org, p_settings) then
    raise exception 'invalid_settings' using errcode = '22023';
  end if;
  if jsonb_typeof(p_steps) is distinct from 'array' then raise exception 'invalid_steps' using errcode = '22023'; end if;
  if v_id is not null then
    select status into v_status from public.sequences where id = v_id and organization_id = p_org for update;
    if not found then raise exception 'sequence_not_found' using errcode = 'P0002'; end if;
    if v_status = 'active' and jsonb_array_length(p_steps) = 0 then
      raise exception 'no_steps' using errcode = '22023';
    end if;
    -- 7B Task 5: ordem de travas inscrição → entrega (a mesma da saída por mensagem e do agendamento)
    perform 1 from public.sequence_enrollments where sequence_id = v_id and status = 'active' order by id for update;
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
  -- Entregas ainda pendentes de passos removidos não saem; as em 'sending' terminam.
  update public.outreach_deliveries d set status = 'cancelled', reason = 'step_removed', claim_token = null,
      claimed_until = null
    where d.status = 'pending' and d.step_id in (select st.id from public.sequence_steps st
      where st.sequence_id = v_id and st.removed_at is not null);
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

  -- 7B Task 5: inscrições seguem a renumeração; a que perdeu o passo pendente (removido) segue para o seguinte
  update public.sequence_enrollments e set current_position = st.position
    from public.outreach_deliveries d join public.sequence_steps st on st.id = d.step_id
    where d.enrollment_id = e.id and d.status in ('pending', 'sending') and st.removed_at is null
      and e.sequence_id = v_id and e.status = 'active' and e.current_position <> st.position;
  for s_enrollment in select e.id from public.sequence_enrollments e
      where e.sequence_id = v_id and e.status = 'active'
        and not exists (select 1 from public.outreach_deliveries d
          where d.enrollment_id = e.id and d.status in ('pending', 'sending'))
      order by e.created_at, e.id loop
    perform private.sequence_schedule_next(s_enrollment);
  end loop;
  return v_id;
end $$;

-- ---------------------------------------------------------------- efeitos do passo de automação
-- Sobre 000004: efeitos sequence_enroll / sequence_remove com sequenceId (uuid).
create or replace function private.automation_validate_step(p_step jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_route jsonb; v_key text; e jsonb; v_ai jsonb;
begin
  if p_step is null or jsonb_typeof(p_step) <> 'object'
     or jsonb_typeof(p_step -> 'nodeId') is distinct from 'string' or (p_step ->> 'nodeId') !~ v_uuid
     or jsonb_typeof(p_step -> 'iteration') is distinct from 'number' or (p_step ->> 'iteration') !~ '^[0-9]{1,9}$'
     or coalesce(jsonb_typeof(p_step -> 'handle'), 'null') not in ('string', 'null')
     or (p_step ->> 'handle') !~ '^(default|true|false|no_reply|sent|handoff|opt:[a-z0-9]{1,12})$'
     or jsonb_typeof(p_step -> 'effects') is distinct from 'array' or jsonb_array_length(p_step -> 'effects') > 20
     or coalesce(jsonb_typeof(p_step -> 'error'), 'null') not in ('string', 'null') then
    raise exception 'invalid step' using errcode = '22023';
  end if;

  v_route := p_step -> 'route';
  if jsonb_typeof(v_route) is distinct from 'object' or (select count(*) from jsonb_object_keys(v_route)) <> 1 then
    raise exception 'invalid route' using errcode = '22023';
  end if;
  select k into v_key from jsonb_object_keys(v_route) k;
  if not ((v_key = 'next' and jsonb_typeof(v_route -> 'next') = 'string' and (v_route ->> 'next') ~ v_uuid)
       or (v_key in ('waitReply', 'waitDelay') and jsonb_typeof(v_route -> v_key) = 'object'
           and jsonb_typeof(v_route -> v_key -> 'until') = 'string')
       or (v_key = 'end' and v_route -> 'end' = 'true'::jsonb)) then
    raise exception 'invalid route' using errcode = '22023';
  end if;

  for e in select * from jsonb_array_elements(p_step -> 'effects') loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'type') is distinct from 'string' then
      raise exception 'invalid effect' using errcode = '22023';
    end if;
    case e ->> 'type'
      when 'add_tag', 'remove_tag' then
        if jsonb_typeof(e -> 'tagId') is distinct from 'string' or (e ->> 'tagId') !~ v_uuid then raise exception 'invalid effect' using errcode = '22023'; end if;
      when 'assign_user' then
        if jsonb_typeof(e -> 'userId') is distinct from 'string' or (e ->> 'userId') !~ v_uuid then raise exception 'invalid effect' using errcode = '22023'; end if;
      when 'move_stage' then
        if jsonb_typeof(e -> 'stageId') is distinct from 'string' or (e ->> 'stageId') !~ v_uuid then raise exception 'invalid effect' using errcode = '22023'; end if;
      when 'send_text' then
        if jsonb_typeof(e -> 'text') is distinct from 'string' or (e ->> 'text') !~ '[^[:space:]]'
           or coalesce(jsonb_typeof(e -> 'buttons'), 'array') <> 'array' or jsonb_array_length(coalesce(e -> 'buttons', '[]')) > 3
           or coalesce(jsonb_typeof(e -> 'quickReplies'), 'array') <> 'array' or jsonb_array_length(coalesce(e -> 'quickReplies', '[]')) > 13
           or coalesce(jsonb_typeof(e -> 'instagram'), 'null') not in ('object', 'null') then
          raise exception 'invalid effect' using errcode = '22023';
        end if;
      when 'sequence_enroll', 'sequence_remove' then
        if jsonb_typeof(e -> 'sequenceId') is distinct from 'string' or (e ->> 'sequenceId') !~ v_uuid then raise exception 'invalid effect' using errcode = '22023'; end if;
      when 'ai_message', 'webhook', 'close_conversation', 'handoff_ai', 'handoff_human' then
        null;
      else
        raise exception 'invalid effect' using errcode = '22023';
    end case;
  end loop;

  v_ai := nullif(p_step -> 'aiReply', 'null'::jsonb);
  if v_ai is not null and (jsonb_typeof(v_ai) <> 'object'
      or jsonb_typeof(v_ai -> 'text') is distinct from 'string' or (v_ai ->> 'text') !~ '[^[:space:]]'
      or jsonb_typeof(v_ai -> 'usedChunkIds') is distinct from 'array' or jsonb_array_length(v_ai -> 'usedChunkIds') > 50
      or exists (select 1 from jsonb_array_elements(v_ai -> 'usedChunkIds') x
                 where jsonb_typeof(x) <> 'string' or (x #>> '{}') !~* v_uuid)) then
    raise exception 'invalid ai reply' using errcode = '22023';
  end if;
end $$;

-- Sobre 000009 (mesmo corpo): efeitos sequence_enroll / sequence_remove para o contato da execução (e a variável
-- v_refused).
create or replace function private.automation_apply_step(p_run uuid, p_token uuid, p_step jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  run public.automation_runs;
  conv public.conversations;
  v_node_id uuid := (p_step ->> 'nodeId')::uuid;
  v_iteration int := (p_step ->> 'iteration')::int;
  v_handle text := p_step ->> 'handle';
  v_ai jsonb := nullif(p_step -> 'aiReply', 'null'::jsonb);
  v_route jsonb := p_step -> 'route';
  v_graph jsonb; v_node jsonb; v_out jsonb; v_resume boolean := false; v_has_step boolean;
  v_next uuid; v_until timestamptz; v_kind text;
  e jsonb; v_text text; v_block text; v_send record; v_cand uuid; v_send_block text; v_conv_checked boolean := false;
  v_terminal boolean := false; v_reroute boolean := false;
  v_result text; v_intents uuid[] := '{}'; v_payloads jsonb := '{}'::jsonb; v_status public.run_status; v_error text;
  v_typed boolean;
  v_refused text;
begin
  run := private.automation_lock_run(p_run);
  if run.id is null then raise exception 'invalid claim' using errcode = '42501'; end if;

  select s.output into v_out from public.automation_run_steps s
    where s.run_id = run.id and s.node_id = v_node_id and s.iteration = v_iteration;
  v_has_step := found;
  v_resume := v_has_step and run.status = 'running' and p_token is not null and run.claim_token = p_token
    and run.waiting_for is not null and run.current_node_id = v_node_id and run.iteration = v_iteration;
  -- replay: o passo já foi aplicado, devolve o resultado gravado sem efeito algum
  if v_has_step and not v_resume then return v_out; end if;

  if run.status <> 'running' or p_token is null or run.claim_token is distinct from p_token then
    raise exception 'invalid claim' using errcode = '42501';
  end if;
  if v_iteration <> run.iteration or v_node_id is distinct from run.current_node_id then
    raise exception 'invalid step node' using errcode = '22023';
  end if;
  if run.waiting_for is not null and not v_resume then
    raise exception 'wait not resolved' using errcode = '22023';
  end if;
  v_graph := private.automation_run_graph(run);
  v_node := private.automation_graph_node(v_graph, v_node_id);
  if v_node is null then raise exception 'invalid step node' using errcode = '22023'; end if;

  select k into v_kind from jsonb_object_keys(v_route) k;
  if v_kind = 'next' then
    v_next := (v_route ->> 'next')::uuid;
    if private.automation_graph_node(v_graph, v_next) is null then raise exception 'invalid next' using errcode = '22023'; end if;
  elsif v_kind in ('waitReply', 'waitDelay') then
    begin
      v_until := (v_route -> v_kind ->> 'until')::timestamptz;
    exception when others then
      raise exception 'invalid until' using errcode = '22023';
    end;
    if v_until is null or v_until > now() + interval '7 days 1 hour' then
      raise exception 'invalid until' using errcode = '22023';
    end if;
  end if;

  -- conversa da execução fechada desde o último passo: cancela (result conversation_closed) e libera o
  -- vínculo; a execução nunca é estacionada em espera numa conversa fechada.
  if run.conversation_id is not null then
    select * into conv from public.conversations where id = run.conversation_id;
    if conv.id is null or conv.status = 'closed' then
      v_out := jsonb_build_object('state', 'cancelled', 'intentIds', '[]'::jsonb, 'payloads', '{}'::jsonb,
        'result', 'conversation_closed', 'currentNodeId', v_node_id);
      perform private.automation_cancel_run(run.id);
      if v_resume then
        update public.automation_run_steps set status = 'cancelled', output = v_out
          where run_id = run.id and node_id = v_node_id and iteration = v_iteration;
      else
        insert into public.automation_run_steps (organization_id, run_id, node_id, iteration, status, output, handle)
          values (run.organization_id, run.id, v_node_id, v_iteration, 'cancelled', v_out, v_handle);
      end if;
      return v_out;
    end if;
  end if;

  -- retomada da espera: conclui o passo do nó de espera com o handle resolvido. O worker é um serviço
  -- confiável: o handle não é conferido contra input aqui (o worker o calcula com resolveReply sobre o
  -- input devolvido por prepare); só se exige que a execução esteja de fato aguardando neste nó.
  if v_resume then
    if jsonb_array_length(p_step -> 'effects') > 0 or v_kind not in ('next', 'end') or v_handle is null then
      raise exception 'invalid resume' using errcode = '22023';
    end if;
    -- texto digitado pelo cliente (não um clique assinado nem o fim do prazo)
    v_typed := run.waiting_for = 'reply' and run.input is not null and run.input ->> 'optionId' is null
      and run.input ->> 'text' is not null;
    if v_kind = 'next' then
      update public.automation_runs set current_node_id = v_next, waiting_for = null, wait_node_id = null, input = null,
        resume_at = null where id = run.id;
      v_status := 'running';
    else
      update public.automation_runs set status = 'completed', waiting_for = null, wait_node_id = null, input = null,
        resume_at = null, claim_token = null, claimed_until = null where id = run.id;
      perform private.automation_release(run.id);
      v_status := 'completed';
    end if;
    v_out := jsonb_build_object('state', v_status, 'intentIds', '[]'::jsonb, 'payloads', '{}'::jsonb, 'result', null,
      'currentNodeId', case when v_kind = 'next' then v_next else v_node_id end)
      || case when v_typed then '{"typedReply":true}'::jsonb else '{}'::jsonb end;
    update public.automation_run_steps set status = 'completed', handle = v_handle, output = v_out
      where run_id = run.id and node_id = v_node_id and iteration = v_iteration;
    if v_status = 'completed' and v_typed and conv.id is not null then
      perform private.automation_enqueue_ai(conv.id);
    end if;
    return v_out;
  end if;

  -- limite de passos e erro informado pelo worker: falha sem efeitos
  if run.step_count >= 50 or p_step ->> 'error' is not null then
    v_error := case when run.step_count >= 50 then 'max_steps'
                    when p_step ->> 'error' ~ '^[a-z0-9_]{1,64}$' then p_step ->> 'error' else 'invalid_code' end;
    v_out := jsonb_build_object('state', 'failed', 'intentIds', '[]'::jsonb, 'payloads', '{}'::jsonb, 'result', v_error,
      'currentNodeId', v_node_id);
    insert into public.automation_run_steps (organization_id, run_id, node_id, iteration, status, output, error, handle)
      values (run.organization_id, run.id, v_node_id, v_iteration, 'failed', v_out, v_error, v_handle);
    update public.automation_runs set status = 'failed', error = v_error, claim_token = null, claimed_until = null,
      resume_at = null, step_count = step_count + 1 where id = run.id;
    perform private.automation_release(run.id);
    return v_out;
  end if;

  -- efeitos
  for e in select * from jsonb_array_elements(p_step -> 'effects') loop
    case e ->> 'type'
    when 'add_tag' then
      if run.contact_id is not null and exists (select 1 from public.tags t
          where t.id = (e ->> 'tagId')::uuid and t.organization_id = run.organization_id) then
        insert into public.contact_tags (organization_id, contact_id, tag_id)
          values (run.organization_id, run.contact_id, (e ->> 'tagId')::uuid)
          on conflict (contact_id, tag_id) do nothing;
      end if;
    when 'remove_tag' then
      delete from public.contact_tags
        where organization_id = run.organization_id and contact_id = run.contact_id and tag_id = (e ->> 'tagId')::uuid;
    when 'assign_user' then
      -- só membros da organização; conversa quando houver, senão o responsável do contato
      if exists (select 1 from public.memberships m
          where m.organization_id = run.organization_id and m.user_id = (e ->> 'userId')::uuid) then
        if conv.id is not null then
          update public.conversations set assigned_to = (e ->> 'userId')::uuid where id = conv.id;
        elsif run.contact_id is not null then
          update public.contacts set assigned_to = (e ->> 'userId')::uuid
            where id = run.contact_id and organization_id = run.organization_id;
        end if;
      end if;
    when 'move_stage' then
      perform private.automation_move_stage(run.organization_id, run.contact_id, (e ->> 'stageId')::uuid);
    -- encerrar a conversa é terminal: nada roda depois (a saída do bloco é ignorada)
    when 'close_conversation' then
      v_terminal := true;
      if conv.id is not null then
        update public.conversations set status = 'closed' where id = conv.id and status <> 'closed';
        select * into conv from public.conversations where id = conv.id;
      end if;
    -- transferências são terminais: a execução termina 'completed' (a saída do bloco é ignorada)
    when 'handoff_ai' then
      v_terminal := true;
      if conv.id is not null then
        update public.conversations set handled_by = 'ai', status = 'open', handoff_reason = null, automation_run_id = null
          where id = conv.id;
        -- a última mensagem do cliente ficou sem resposta: a IA responde (regras da Fase 6)
        perform private.automation_enqueue_ai(conv.id);
      end if;
    when 'handoff_human' then
      v_terminal := true;
      if conv.id is not null then
        update public.conversations set status = 'pending_human', handled_by = 'human', handoff_reason = 'automation'
          where id = conv.id;
        insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content, status)
          values (conv.organization_id, conv.id, conv.channel_id, 'outbound', 'system',
            'Automação transferiu para atendimento humano', 'delivered');
      end if;
    when 'send_text', 'ai_message' then
      if e ->> 'type' = 'ai_message' and v_ai is null then continue; end if;
      -- conversa de destino (execução de contato: liga a conversa aberta e livre; ocupada → pula)
      if not v_conv_checked then
        v_conv_checked := true;
        if conv.id is null and run.conversation_id is null and run.contact_id is not null then
          v_cand := private.automation_contact_conversation(run.organization_id, run.contact_id);
          if v_cand is not null then
            select * into conv from public.conversations where id = v_cand for update skip locked;
            if not found then
              v_send_block := 'conversation_busy';
            elsif private.automation_conversation_busy(run.organization_id, conv.id, run.id) then
              v_send_block := 'conversation_busy';
              conv := null;
            else
              update public.automation_runs set conversation_id = conv.id where id = run.id;
              run.conversation_id := conv.id;
              perform private.automation_link_run(conv.id, run.id);
              select * into conv from public.conversations where id = conv.id;
            end if;
          end if;
        end if;
        if v_send_block is null and conv.id is null then v_send_block := 'no_conversation'; end if;
      end if;
      if v_send_block is not null then
        v_result := v_send_block;
        continue;
      end if;
      v_text := case when e ->> 'type' = 'ai_message' then v_ai ->> 'text' else e ->> 'text' end;
      -- bloqueios do canal antes de qualquer escrita e antes de consumir a cota da IA
      v_block := private.automation_send_blocker(conv, v_text);
      if v_block is not null then
        v_result := v_block;
        -- texto longo da IA segue pela saída handoff; o de send_text conclui a execução
        if v_block = 'reply_too_long' and e ->> 'type' = 'ai_message' then v_reroute := true; end if;
        continue;
      end if;
      if e ->> 'type' = 'ai_message' then
        if not public.consume_ai_quota(run.organization_id, 'reply') then
          v_result := 'quota_exceeded';
          v_reroute := true;
          continue;
        end if;
        select * into v_send from private.automation_deliver(run.id, conv, v_node_id, v_text, null, null,
          jsonb_build_object('text', v_text), jsonb_build_object('usedChunkIds', v_ai -> 'usedChunkIds'));
      else
        select * into v_send from private.automation_deliver(run.id, conv, v_node_id, e ->> 'text',
          e -> 'buttons', e -> 'quickReplies', nullif(e -> 'instagram', 'null'::jsonb), null);
      end if;
      v_result := v_send.result;
      if v_send.intent_id is not null then v_intents := v_intents || v_send.intent_id; end if;
      if v_send.result in ('sent', 'queued') then
        v_payloads := v_payloads || private.automation_node_payloads(run.id, v_node);
      end if;
    -- 7B: sequências (ações que não seguram a conversa). Sem contato, sequência de outra organização/inexistente ou
    -- recusa de sequence_enroll (22023: sequence_not_active | invalid_contact | invalid_channel): o bloco segue e a
    -- recusa fica registrada no evento sequence_enroll_refused {sequence_id, reason (código), run_id}.
    when 'sequence_enroll' then
      v_refused := null;
      if run.contact_id is null then
        v_refused := 'no_contact';
      elsif not exists (select 1 from public.sequences sq
          where sq.id = (e ->> 'sequenceId')::uuid and sq.organization_id = run.organization_id) then
        v_refused := 'sequence_not_found';
      else
        begin
          perform private.sequence_enroll((e ->> 'sequenceId')::uuid, run.contact_id, 'automation');
        exception when invalid_parameter_value then
          v_refused := case when sqlerrm ~ '^[a-z0-9_]{1,64}$' then sqlerrm else 'invalid' end;
        end;
      end if;
      if v_refused is not null then
        insert into public.events (organization_id, type, conversation_id, contact_id, actor_type, payload)
          values (run.organization_id, 'sequence_enroll_refused', conv.id, run.contact_id, 'automation',
            jsonb_build_object('sequence_id', e ->> 'sequenceId', 'reason', v_refused, 'run_id', run.id));
      end if;
    when 'sequence_remove' then
      if run.contact_id is not null and exists (select 1 from public.sequences sq
          where sq.id = (e ->> 'sequenceId')::uuid and sq.organization_id = run.organization_id) then
        perform private.sequence_remove((e ->> 'sequenceId')::uuid, run.contact_id, 'removed');
      end if;
    else
      null; -- webhook: executado pelo worker antes do apply
    end case;
  end loop;

  -- rota final (resultados que mudam a rota têm prioridade sobre a do worker)
  if v_result = 'conversation_closed' then
    v_status := 'cancelled';
  elsif v_result = 'channel_unavailable' then
    v_status := 'failed'; v_error := 'channel_unavailable';
  elsif v_result = 'window_closed' then
    v_status := 'completed';
  elsif v_reroute then
    v_handle := 'handoff';
    v_next := private.automation_graph_target(v_graph, v_node_id, 'handoff');
    v_status := case when v_next is null then 'completed' else 'running' end;
  elsif v_result = 'reply_too_long' or v_terminal then
    v_status := 'completed';
  elsif v_kind = 'next' then
    v_status := 'running';
  elsif v_kind in ('waitReply', 'waitDelay') then
    v_status := 'waiting';
  else
    v_status := 'completed';
  end if;

  if v_status = 'running' then
    update public.automation_runs set current_node_id = v_next, step_count = step_count + 1, waiting_for = null,
      wait_node_id = null, input = null where id = run.id;
  elsif v_status = 'waiting' then
    update public.automation_runs set status = 'waiting', current_node_id = v_node_id, step_count = step_count + 1,
      waiting_for = case when v_kind = 'waitReply' then 'reply' else 'delay' end, wait_node_id = v_node_id, input = null,
      resume_at = v_until, attempts = 0, claim_token = null, claimed_until = null where id = run.id;
  else
    update public.automation_runs set status = v_status, error = v_error, step_count = step_count + 1, waiting_for = null,
      wait_node_id = null, input = null, resume_at = null, claim_token = null, claimed_until = null where id = run.id;
    perform private.automation_release(run.id);
  end if;

  v_out := jsonb_build_object('state', v_status, 'intentIds', to_jsonb(v_intents), 'payloads', v_payloads,
    'result', v_result, 'currentNodeId', case when v_status = 'running' then v_next else v_node_id end);
  insert into public.automation_run_steps (organization_id, run_id, node_id, iteration, status, output, error, handle)
    values (run.organization_id, run.id, v_node_id, v_iteration,
      case v_status when 'running' then 'completed' else v_status end, v_out, v_error, v_handle);

  -- execução retomada por texto digitado que termina sem responder depois dele: a IA atende a mensagem
  if v_status = 'completed' and conv.id is not null and exists (select 1 from public.automation_run_steps s
      where s.run_id = run.id and s.iteration = run.iteration and s.output ->> 'typedReply' = 'true') then
    perform private.automation_enqueue_ai(conv.id);
  end if;
  return v_out;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function
  private.next_send_time(timestamptz, int, jsonb, text),
  private.sequence_conversation(uuid, uuid, uuid[]),
  private.exit_word_strip(text),
  private.is_exit_word(text, jsonb),
  private.sequence_schedule_next(uuid),
  private.sequence_enroll(uuid, uuid, text),
  private.sequence_end_enrollment(uuid, text, text),
  private.sequence_remove(uuid, uuid, text),
  private.sequence_exit_inbound(),
  private.sequence_contact_deleted()
  from public, anon, authenticated;
revoke all on function public.enroll_contact_in_sequence(uuid, uuid), public.remove_contact_from_sequence(uuid, uuid)
  from public, anon;
grant execute on function public.enroll_contact_in_sequence(uuid, uuid), public.remove_contact_from_sequence(uuid, uuid)
  to authenticated;
