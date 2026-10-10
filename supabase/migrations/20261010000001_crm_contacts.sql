-- Fase 3 (CRM): save_contact, search_contacts, edição de tags só para admin+,
-- auditoria de CRM e índices de apoio.

-- ------------------------------------------------------------------ save_contact
-- SECURITY INVOKER: RLS e grants de coluna do chamador valem. Transacional (uma função = uma transação).
create function public.save_contact(
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
    insert into public.contacts (organization_id, name, phone, email, status, assigned_to, lead_score, source)
    values (
      p_org,
      v_data ->> 'name',
      v_data ->> 'phone',
      v_data ->> 'email',
      coalesce((v_data ->> 'status')::public.contact_status, 'lead'),
      (v_data ->> 'assigned_to')::uuid,
      coalesce((v_data ->> 'lead_score')::int, 0),
      'manual'
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

  delete from public.contact_tags where contact_id = v_id and organization_id = p_org;
  if p_tag_ids is not null and cardinality(p_tag_ids) > 0 then
    insert into public.contact_tags (organization_id, contact_id, tag_id)
    select p_org, v_id, t from unnest(p_tag_ids) as t group by t;
  end if;

  delete from public.contact_custom_fields where contact_id = v_id and organization_id = p_org;
  if p_custom_fields is not null and jsonb_array_length(p_custom_fields) > 0 then
    insert into public.contact_custom_fields (organization_id, contact_id, key, value)
    select p_org, v_id, f ->> 'key', f ->> 'value'
    from jsonb_array_elements(p_custom_fields) f;
  end if;

  return v_id;
end $$;

revoke all on function public.save_contact(uuid, uuid, jsonb, uuid[], jsonb) from public, anon;
grant execute on function public.save_contact(uuid, uuid, jsonb, uuid[], jsonb) to authenticated;

-- ------------------------------------------------------------------ search_contacts
-- unaccent não é immutable: a função é stable. SECURITY INVOKER (RLS decide a visibilidade).
create function public.search_contacts(
  p_org uuid,
  p_q text,
  p_status public.contact_status,
  p_tag uuid,
  p_assignee text,
  p_source public.contact_source,
  p_order text,
  p_limit int,
  p_offset int
) returns table (
  id uuid,
  name text,
  phone text,
  email text,
  status public.contact_status,
  source public.contact_source,
  lead_score int,
  assigned_to uuid,
  last_interaction_at timestamptz,
  created_at timestamptz,
  tag_ids uuid[],
  total_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_pattern text;
  v_digits text;
  v_order text := coalesce(p_order, 'interacao');
begin
  if v_q is not null then
    v_pattern := '%' || extensions.unaccent(lower(
      replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_'))) || '%';
    v_digits := regexp_replace(v_q, '\D', '', 'g');
    if length(v_digits) < 3 then
      v_digits := null;
    end if;
  end if;

  return query
  select c.id, c.name, c.phone, c.email, c.status, c.source, c.lead_score, c.assigned_to,
         c.last_interaction_at, c.created_at,
         coalesce((select array_agg(ct.tag_id order by ct.tag_id)
                   from public.contact_tags ct where ct.contact_id = c.id), '{}'::uuid[]),
         count(*) over ()
  from public.contacts c
  where c.organization_id = p_org
    and (p_status is null or c.status = p_status)
    and (p_source is null or c.source = p_source)
    and (p_tag is null or exists (
          select 1 from public.contact_tags ct where ct.contact_id = c.id and ct.tag_id = p_tag))
    and (p_assignee is null
         or (p_assignee = 'nenhum' and c.assigned_to is null)
         or (p_assignee <> 'nenhum' and c.assigned_to = p_assignee::uuid))
    and (v_q is null
         or extensions.unaccent(lower(coalesce(c.name, ''))) like v_pattern
         or extensions.unaccent(lower(coalesce(c.email, ''))) like v_pattern
         or (v_digits is not null
             and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like '%' || v_digits || '%'))
  order by
    case when v_order = 'nome' then lower(c.name) end asc nulls last,
    case when v_order = 'score' then c.lead_score end desc,
    case when v_order not in ('nome', 'criado', 'score') then c.last_interaction_at end desc nulls last,
    case when v_order <> 'nome' and v_order <> 'score' then c.created_at end desc,
    c.id
  limit greatest(coalesce(p_limit, 25), 0)
  offset greatest(coalesce(p_offset, 0), 0);
end $$;

revoke all on function public.search_contacts(uuid, text, public.contact_status, uuid, text, public.contact_source, text, int, int) from public, anon;
grant execute on function public.search_contacts(uuid, text, public.contact_status, uuid, text, public.contact_source, text, int, int) to authenticated;

-- ------------------------------------------------------------------ tags: edição só admin+
drop policy tags_update on public.tags;
create policy tags_update on public.tags
  for update to authenticated
  using (public.has_role(organization_id, 'admin'))
  with check (public.has_role(organization_id, 'admin'));

-- ------------------------------------------------------------------ auditoria
create trigger pipelines_audit after insert or update or delete on public.pipelines
  for each row execute function public.audit_row_change();
create trigger pipeline_stages_audit after insert or update or delete on public.pipeline_stages
  for each row execute function public.audit_row_change();
create trigger contacts_audit after delete on public.contacts
  for each row execute function public.audit_row_change();
create trigger deals_audit after delete on public.deals
  for each row execute function public.audit_row_change();
create trigger tags_audit after delete on public.tags
  for each row execute function public.audit_row_change();

-- ------------------------------------------------------------------ índices
create index events_org_contact_idx on public.events (organization_id, contact_id);
create index events_org_deal_idx on public.events (organization_id, deal_id);
create index deals_org_pipeline_idx on public.deals (organization_id, pipeline_id);
