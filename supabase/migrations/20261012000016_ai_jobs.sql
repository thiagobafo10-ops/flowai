-- Fase 6 (IA): fila de tarefas, cota diária e despacho do ai-worker.

-- ---------------------------------------------------------------- limites
create table private.ai_settings (
  singleton boolean primary key default true check (singleton),
  daily_replies int not null default 300 check (daily_replies >= 0),
  daily_tests int not null default 30 check (daily_tests >= 0)
);
insert into private.ai_settings default values;
alter table private.ai_settings enable row level security;
revoke all on private.ai_settings from anon, authenticated;

create table private.ai_limit_overrides (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  daily_replies int check (daily_replies >= 0),
  daily_tests int check (daily_tests >= 0)
);
alter table private.ai_limit_overrides enable row level security;
revoke all on private.ai_limit_overrides from anon, authenticated;

-- ---------------------------------------------------------------- uso diário
create table public.ai_usage_daily (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  day date not null,
  replies int not null default 0,
  tests int not null default 0,
  primary key (organization_id, day)
);
alter table public.ai_usage_daily enable row level security;
revoke all on public.ai_usage_daily from anon, authenticated;
grant select on public.ai_usage_daily to authenticated;
create policy ai_usage_daily_select on public.ai_usage_daily for select to authenticated
  using (public.is_member(organization_id));

-- ---------------------------------------------------------------- fila
create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('reply', 'index_document')),
  conversation_id uuid,
  document_id uuid,
  document_generation int,
  state text not null default 'pending' check (state in ('pending', 'running', 'done', 'failed', 'cancelled')),
  attempts int not null default 0,
  run_after timestamptz not null default now(),
  claim_token uuid,
  claimed_until timestamptz,
  last_error text check (char_length(last_error) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind <> 'reply' or conversation_id is not null) and (kind <> 'index_document' or document_id is not null)),
  foreign key (organization_id, conversation_id)
    references public.conversations (organization_id, id) on delete cascade,
  foreign key (organization_id, document_id)
    references public.knowledge_documents (organization_id, id) on delete cascade
);
create unique index ai_jobs_reply_pending_uq on public.ai_jobs (conversation_id)
  where kind = 'reply' and state = 'pending';
create unique index ai_jobs_index_pending_uq on public.ai_jobs (document_id)
  where kind = 'index_document' and state = 'pending';
create index ai_jobs_state_run_after_idx on public.ai_jobs (state, run_after);
create trigger ai_jobs_set_updated_at before update on public.ai_jobs
  for each row execute function public.set_updated_at();
alter table public.ai_jobs enable row level security;
revoke all on public.ai_jobs from anon, authenticated;

-- ---------------------------------------------------------------- cota
create function public.ai_quota(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_day date; v_used public.ai_usage_daily; v_rl int; v_tl int;
begin
  if not public.is_member(p_org) then raise exception 'forbidden' using errcode = '42501'; end if;
  select (now() at time zone o.timezone)::date into v_day from public.organizations o where o.id = p_org;
  select * into v_used from public.ai_usage_daily where organization_id = p_org and day = v_day;
  select coalesce(ov.daily_replies, s.daily_replies), coalesce(ov.daily_tests, s.daily_tests) into v_rl, v_tl
    from private.ai_settings s left join private.ai_limit_overrides ov on ov.organization_id = p_org;
  return jsonb_build_object('replies', coalesce(v_used.replies, 0), 'repliesLimit', v_rl,
    'tests', coalesce(v_used.tests, 0), 'testsLimit', v_tl);
end $$;

create function public.consume_ai_quota(p_org uuid, p_kind text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_day date; v_limit int; v_ok boolean;
begin
  if p_kind is null or p_kind not in ('reply', 'test') then raise exception 'invalid kind' using errcode = '22023'; end if;
  select (now() at time zone o.timezone)::date into v_day from public.organizations o where o.id = p_org;
  if v_day is null then return false; end if;
  select case p_kind when 'reply' then coalesce(ov.daily_replies, s.daily_replies)
                     else coalesce(ov.daily_tests, s.daily_tests) end into v_limit
    from private.ai_settings s left join private.ai_limit_overrides ov on ov.organization_id = p_org;
  if coalesce(v_limit, 0) <= 0 then return false; end if;
  if p_kind = 'reply' then
    insert into public.ai_usage_daily as u (organization_id, day, replies) values (p_org, v_day, 1)
      on conflict (organization_id, day) do update set replies = u.replies + 1 where u.replies < v_limit
      returning true into v_ok;
  else
    insert into public.ai_usage_daily as u (organization_id, day, tests) values (p_org, v_day, 1)
      on conflict (organization_id, day) do update set tests = u.tests + 1 where u.tests < v_limit
      returning true into v_ok;
  end if;
  return coalesce(v_ok, false);
end $$;

-- ---------------------------------------------------------------- worker
create table private.ai_worker_config (
  singleton boolean primary key default true check (singleton),
  base_url text not null,
  service_key_secret_id uuid not null,
  worker_secret_id uuid not null
);
alter table private.ai_worker_config enable row level security;
revoke all on private.ai_worker_config from anon, authenticated;

create function public.configure_ai_worker(p_base_url text, p_service_key text, p_worker_secret text) returns void
language plpgsql security definer set search_path = '' as $$
declare old_config private.ai_worker_config; service_id uuid; worker_id uuid;
begin
  if p_base_url !~ '^(https://[a-z0-9.-]+(:[0-9]+)?|http://(localhost|127\.0\.0\.1|kong|supabase_kong_flowai)(:[0-9]+)?)$'
    or coalesce(length(p_service_key), 0) < 20 or coalesce(length(p_worker_secret), 0) < 32 then
    raise exception 'invalid worker config' using errcode = '22023';
  end if;
  select * into old_config from private.ai_worker_config for update;
  if found then
    perform vault.update_secret(old_config.service_key_secret_id, p_service_key);
    perform vault.update_secret(old_config.worker_secret_id, p_worker_secret);
    update private.ai_worker_config set base_url = p_base_url;
  else
    select vault.create_secret(p_service_key, 'flowai-ai-worker-service') into service_id;
    select vault.create_secret(p_worker_secret, 'flowai-ai-worker-secret') into worker_id;
    insert into private.ai_worker_config values (true, p_base_url, service_id, worker_id);
  end if;
end $$;

create function public.read_ai_worker_config() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('workerSecret', s.decrypted_secret)
  from private.ai_worker_config c join vault.decrypted_secrets s on s.id = c.worker_secret_id;
$$;

-- Chamado quando uma tarefa esgota as tentativas; os Tasks 5 e 6 recriam com create or replace.
create function private.ai_job_gave_up(job public.ai_jobs) returns void
language plpgsql security definer set search_path = '' as $$
begin
  null;
end $$;

create function public.fail_ai_job(p_job uuid, p_token uuid, p_error_code text, p_retryable boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare job public.ai_jobs; v_code text;
begin
  if p_token is null then return; end if;
  select * into job from public.ai_jobs where id = p_job and state = 'running' and claim_token = p_token for update;
  if not found then return; end if;
  v_code := case when p_error_code ~ '^[a-z0-9_]{1,64}$' then p_error_code else 'invalid_code' end;
  if p_retryable and job.attempts < 3 then
    -- Já existe tarefa pendente para o mesmo alvo: ela a substitui (relê o estado atual).
    if exists (select 1 from public.ai_jobs o where o.id <> job.id and o.state = 'pending' and o.organization_id = job.organization_id
        and ((job.kind = 'reply' and o.kind = 'reply' and o.conversation_id = job.conversation_id)
          or (job.kind = 'index_document' and o.kind = 'index_document' and o.document_id = job.document_id))) then
      update public.ai_jobs set state = 'cancelled', claim_token = null, claimed_until = null, last_error = v_code where id = job.id;
      return;
    end if;
    begin
      update public.ai_jobs set state = 'pending', claim_token = null, claimed_until = null, last_error = v_code,
        run_after = now() + (array[10, 30, 90])[job.attempts] * interval '1 second' where id = job.id;
    exception when unique_violation then
      update public.ai_jobs set state = 'cancelled', claim_token = null, claimed_until = null, last_error = v_code where id = job.id;
    end;
  else
    update public.ai_jobs set state = 'failed', claim_token = null, claimed_until = null, last_error = v_code
      where id = job.id returning * into job;
    perform private.ai_job_gave_up(job);
  end if;
end $$;

create function public.sweep_ai_jobs() returns void
language plpgsql security definer set search_path = '' as $$
declare job public.ai_jobs;
begin
  for job in select * from public.ai_jobs where state = 'running' and claimed_until < now() order by claimed_until for update skip locked loop
    begin
      perform public.fail_ai_job(job.id, job.claim_token, 'claim_expired', true);
    exception when others then
      raise warning 'sweep_ai_jobs: job % failed with SQLSTATE %', job.id, sqlstate;
    end;
  end loop;
end $$;

create function public.claim_ai_jobs(p_limit int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  with picked as (
    select id from public.ai_jobs where state = 'pending' and run_after <= now()
    order by run_after, created_at limit least(greatest(coalesce(p_limit, 1), 1), 50) for update skip locked
  ), upd as (
    update public.ai_jobs j set state = 'running', attempts = j.attempts + 1, claim_token = gen_random_uuid(),
      claimed_until = now() + interval '3 minutes'
    from picked where j.id = picked.id returning j.id, j.kind, j.claim_token, j.run_after
  )
  select coalesce(jsonb_agg(jsonb_build_object('jobId', id, 'kind', kind, 'claimToken', claim_token) order by run_after), '[]'::jsonb)
    into v_result from upd;
  return v_result;
end $$;

create function public.dispatch_ai_worker() returns void
language plpgsql security definer set search_path = '' as $$
declare config private.ai_worker_config; service_key text; worker_secret text;
begin
  perform public.sweep_ai_jobs();
  select * into config from private.ai_worker_config;
  if not found then return; end if;
  if not exists (select 1 from public.ai_jobs where state = 'pending' and run_after <= clock_timestamp()) then return; end if;
  select decrypted_secret into service_key from vault.decrypted_secrets where id = config.service_key_secret_id;
  select decrypted_secret into worker_secret from vault.decrypted_secrets where id = config.worker_secret_id;
  perform net.http_post(url := config.base_url || '/functions/v1/ai-worker', body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key,
      'apikey', service_key, 'X-FlowAI-Worker', worker_secret), timeout_milliseconds := 150000);
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function public.ai_quota(uuid) from public, anon;
grant execute on function public.ai_quota(uuid) to authenticated, service_role;
revoke all on function
  public.consume_ai_quota(uuid, text),
  public.configure_ai_worker(text, text, text),
  public.read_ai_worker_config(),
  private.ai_job_gave_up(public.ai_jobs),
  public.fail_ai_job(uuid, uuid, text, boolean),
  public.sweep_ai_jobs(),
  public.claim_ai_jobs(int),
  public.dispatch_ai_worker()
  from public, anon, authenticated;
grant execute on function
  public.consume_ai_quota(uuid, text),
  public.configure_ai_worker(text, text, text),
  public.read_ai_worker_config(),
  public.fail_ai_job(uuid, uuid, text, boolean),
  public.sweep_ai_jobs(),
  public.claim_ai_jobs(int),
  public.dispatch_ai_worker()
  to service_role;

select cron.schedule('flowai-ai-worker', '5 seconds', 'select public.dispatch_ai_worker()');
