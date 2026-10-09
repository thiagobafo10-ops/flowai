-- Hardening pós-revisão da Fase 1:
-- events/audit_logs escritos apenas por código definer do banco; trilha automática
-- de alterações em tabelas sensíveis; colunas imutáveis em organizations.

-- ---------------------------------------------------------------- events
-- Eventos só são emitidos por triggers/RPCs SECURITY DEFINER (fases seguintes).
drop policy events_insert on public.events;
revoke insert on public.events from authenticated;
revoke insert (organization_id, type, conversation_id, contact_id, deal_id, actor_type, actor_id, payload)
  on public.events from authenticated;

-- ---------------------------------------------------------------- audit_logs
alter table public.audit_logs
  add constraint audit_logs_action_length check (char_length(action) <= 100),
  add constraint audit_logs_entity_type_length check (char_length(entity_type) <= 100),
  add constraint audit_logs_metadata_size check (pg_column_size(metadata) <= 8192);

-- write_audit_log permanece para funções definer (owner postgres), não para a API.
revoke execute on function public.write_audit_log(uuid, text, text, uuid, jsonb, inet) from authenticated;

-- Eventos de autenticação registrados pelo próprio usuário (allowlist fechada).
create function public.log_auth_event(p_action text, p_ip inet default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('auth.login') then
    raise exception 'invalid auth event' using errcode = '22023';
  end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, ip)
  values (null, v_uid, p_action, 'user', v_uid, p_ip);
end $$;

revoke all on function public.log_auth_event(text, inet) from public, anon;
grant execute on function public.log_auth_event(text, inet) to authenticated;

-- Trilha automática: '<tabela>.<insert|update|delete>'. Em update, metadata guarda
-- apenas os NOMES das colunas alteradas (nunca valores: channels guarda ids de segredos).
-- audit_logs não tem este trigger (sem recursão) nem FKs (não bloqueia exclusões).
create function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_metadata jsonb := '{}';
  v_changed jsonb;
begin
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_agg(n.key order by n.key), '[]'::jsonb) into v_changed
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o on o.key = n.key
    where n.value is distinct from o.value and n.key <> 'updated_at';
    v_metadata := jsonb_build_object('changed', v_changed);
  end if;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    case when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid
         else (v_row ->> 'organization_id')::uuid end,
    (select auth.uid()),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    v_metadata
  );
  return null;
end $$;

revoke all on function public.audit_row_change() from public, anon, authenticated;

create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function public.audit_row_change();
create trigger organizations_audit after insert or update or delete on public.organizations
  for each row execute function public.audit_row_change();
create trigger channels_audit after insert or update or delete on public.channels
  for each row execute function public.audit_row_change();
create trigger ai_agents_audit after insert or update or delete on public.ai_agents
  for each row execute function public.audit_row_change();
create trigger automations_audit after insert or update or delete on public.automations
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------- organizations
-- slug e timestamps imutáveis pela API.
revoke update on public.organizations from authenticated;
grant update (name, company_info, timezone) on public.organizations to authenticated;
