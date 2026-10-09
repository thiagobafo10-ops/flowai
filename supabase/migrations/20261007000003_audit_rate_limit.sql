-- Audit logs (append-only) + rate limiting

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid, -- no FK on purpose: audit trail outlives entities
  actor_id uuid, -- no FK on purpose (append-only stays absolute)
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}',
  ip inet,
  created_at timestamptz not null default now()
);
create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id);

create function public.audit_logs_block_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_logs is append-only';
end $$;

create trigger audit_logs_append_only
  before update or delete on public.audit_logs
  for each row execute function public.audit_logs_block_mutation();

alter table public.audit_logs enable row level security;

create policy audit_logs_select on public.audit_logs for select to authenticated
using (
  (organization_id is not null and public.has_role(organization_id, 'admin'))
  or (organization_id is null and actor_id = (select auth.uid()))
);

revoke all on public.audit_logs from anon;
revoke insert, update, delete on public.audit_logs from authenticated;

create function public.write_audit_log(
  p_org uuid, p_action text, p_entity_type text, p_entity_id uuid,
  p_metadata jsonb default '{}', p_ip inet default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_org is not null and not public.is_member(p_org) then
    raise exception 'not a member of organization' using errcode = '42501';
  end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata, ip)
  values (p_org, v_uid, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'), p_ip);
end $$;

revoke all on function public.write_audit_log(uuid, text, text, uuid, jsonb, inet) from public, anon;
grant execute on function public.write_audit_log(uuid, text, text, uuid, jsonb, inet) to authenticated;

create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

create function public.check_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_w timestamptz;
  v_cur int;
  v_prev int;
  v_elapsed numeric;
begin
  if p_key is null or length(p_key) = 0 or length(p_key) > 200 then
    raise exception 'invalid rate limit key' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception 'invalid rate limit' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'invalid window' using errcode = '22023';
  end if;
  if random() < 0.01 then
    delete from public.rate_limits where window_start < v_now - interval '1 day';
  end if;
  v_w := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, v_w, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into v_cur;

  select r.count into v_prev from public.rate_limits r
  where r.key = p_key and r.window_start = v_w - make_interval(secs => p_window_seconds);

  delete from public.rate_limits r
  where r.key = p_key and r.window_start < v_now - make_interval(secs => 2 * p_window_seconds);

  v_elapsed := extract(epoch from (v_now - v_w)) / p_window_seconds;
  return coalesce(v_prev, 0) * (1 - v_elapsed) + v_cur <= p_limit;
end $$;

revoke all on function public.check_rate_limit(text, int, int) from public;
grant execute on function public.check_rate_limit(text, int, int) to anon, authenticated;
