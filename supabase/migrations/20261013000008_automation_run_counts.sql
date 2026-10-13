-- Contagem de execuções por automação em uma janela (SECURITY INVOKER: o RLS de automation_runs se aplica).
create function public.automation_run_counts(p_org uuid, p_since timestamptz)
returns table (automation_id uuid, runs bigint)
language sql stable security invoker set search_path = '' as $$
  select r.automation_id, count(*)::bigint
  from public.automation_runs r
  where r.organization_id = p_org and r.created_at >= p_since
  group by r.automation_id
$$;
revoke all on function public.automation_run_counts(uuid, timestamptz) from public, anon;
grant execute on function public.automation_run_counts(uuid, timestamptz) to authenticated;
