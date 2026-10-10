-- save_contact parcial: p_tag_ids / p_custom_fields nulos preservam o conjunto atual
-- (array vazio continua limpando). p_data já atualiza só as chaves presentes.
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

  if p_tag_ids is not null then
    delete from public.contact_tags where contact_id = v_id and organization_id = p_org;
    if cardinality(p_tag_ids) > 0 then
      insert into public.contact_tags (organization_id, contact_id, tag_id)
      select p_org, v_id, t from unnest(p_tag_ids) as t group by t;
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

revoke all on function public.save_contact(uuid, uuid, jsonb, uuid[], jsonb) from public, anon;
grant execute on function public.save_contact(uuid, uuid, jsonb, uuid[], jsonb) to authenticated;
