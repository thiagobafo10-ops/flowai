-- Fase 7A: clique em botões / respostas rápidas de automação no Simulador (agent+).
--
-- O clique vira uma mensagem do contato ingerida pelo ingest de 7 argumentos, com o mesmo context de um
-- clique real (origin 'button' + payload assinado). Toda a validação de escopo (conversa → execução, nó de
-- espera, prazo, opção) continua em private.automation_signed_reply, chamada pelo ingest sob as travas.
--
-- Erros: 42501 = sem permissão (inclui mensagem inexistente ou de outra organização); 22023 com mensagem
-- fixa: 'not_simulator' | 'unknown_option' | 'not_waiting'.
create function public.click_automation_button(p_message_id uuid, p_option_id text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m public.messages;
  v_type public.channel_type;
  v_auto jsonb;
  v_title text;
  v_phone text;
  v_name text;
  v_payload text;
  v_prev_role text;
  v_msg uuid;
begin
  select * into m from public.messages where id = p_message_id;
  if not found or not public.has_role(m.organization_id, 'agent') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select ch.type into v_type from public.channels ch where ch.id = m.channel_id;
  if v_type is distinct from 'simulator' then
    raise exception 'not_simulator' using errcode = '22023';
  end if;

  -- só botões 'path' e respostas rápidas esperam clique (botões de link abrem a URL)
  v_auto := m.context -> 'automation';
  if m.sender_type <> 'automation' or jsonb_typeof(v_auto) is distinct from 'object'
     or coalesce(p_option_id, '') !~ '^[a-z0-9]{1,12}$' then
    raise exception 'unknown_option' using errcode = '22023';
  end if;
  select o ->> 'title' into v_title from (
    select x as o from jsonb_array_elements(case when jsonb_typeof(v_auto -> 'buttons') = 'array'
      then v_auto -> 'buttons' else '[]'::jsonb end) x where x ->> 'kind' = 'path'
    union all
    select x from jsonb_array_elements(case when jsonb_typeof(v_auto -> 'quickReplies') = 'array'
      then v_auto -> 'quickReplies' else '[]'::jsonb end) x
  ) opts where o ->> 'id' = p_option_id limit 1;
  if v_title is null or v_title !~ '[^[:space:]]' then
    raise exception 'unknown_option' using errcode = '22023';
  end if;

  -- a execução precisa ainda aguardar resposta neste nó (verificação rápida; o ingest confere sob as travas)
  if not exists (select 1 from public.automation_runs r
      where r.id = (v_auto ->> 'runId')::uuid and r.organization_id = m.organization_id
        and r.conversation_id = m.conversation_id and r.status = 'waiting' and r.waiting_for = 'reply'
        and r.input is null and r.wait_node_id = (v_auto ->> 'nodeId')::uuid) then
    raise exception 'not_waiting' using errcode = '22023';
  end if;

  select k.phone, k.name into v_phone, v_name from public.conversations c
    join public.contacts k on k.id = c.contact_id and k.organization_id = c.organization_id
    where c.id = m.conversation_id;
  if coalesce(btrim(v_phone), '') = '' then
    raise exception 'not_waiting' using errcode = '22023';
  end if;
  v_payload := private.automation_payload((v_auto ->> 'runId')::uuid, (v_auto ->> 'nodeId')::uuid, p_option_id);

  -- O ingest só aceita usuários autenticados admin+ no Simulador; o papel (agent+) já foi conferido acima,
  -- então a ingestão roda como serviço apenas durante a chamada e o papel anterior é restaurado em seguida.
  v_prev_role := current_setting('request.jwt.claim.role', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  v_msg := public.ingest_inbound_message(m.channel_id, 'click:' || gen_random_uuid()::text, v_phone, v_name, v_title,
    now(), jsonb_build_object('origin', 'button', 'payload', v_payload));
  perform set_config('request.jwt.claim.role', coalesce(v_prev_role, ''), true);
  if v_msg is null then
    raise exception 'not_waiting' using errcode = '22023';
  end if;

  insert into public.events (organization_id, type, conversation_id, contact_id, actor_type, payload)
    select c.organization_id, 'button_clicked', c.id, c.contact_id, 'contact',
      jsonb_build_object('runId', v_auto ->> 'runId', 'nodeId', v_auto ->> 'nodeId', 'optionId', p_option_id)
    from public.messages x join public.conversations c on c.id = x.conversation_id where x.id = v_msg;
  return v_msg;
end $$;

revoke all on function public.click_automation_button(uuid, text) from public, anon;
grant execute on function public.click_automation_button(uuid, text) to authenticated;
