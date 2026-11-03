-- E-mails da loja (etapa 1): configurações do remetente (Resend), reserva/conclusão dos envios pelo
-- worker, eventos do provedor (supressão), descadastro, resultados por passo e o cron do worker.
-- O HTML é montado no worker: a reserva devolve o conteúdo cru do passo e o contexto.

create table public.email_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  from_name text not null check (char_length(from_name) between 1 and 100 and from_name !~ '[<>"\r\n]'),
  from_email text not null check (from_email ~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$'),
  reply_to text check (reply_to ~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$'),
  resend_key_secret_id uuid,
  resend_webhook_secret_id uuid,
  domain_status text check (domain_status in ('verified','pending','failed','not_found')),
  updated_at timestamptz not null default now()
);

create table public.email_unsubscribe_tokens (
  token text primary key default encode(extensions.gen_random_bytes(24),'hex'),
  organization_id uuid not null,
  contact_id uuid not null unique,
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade
);

alter table public.email_settings enable row level security;
alter table public.email_unsubscribe_tokens enable row level security;
revoke all on public.email_settings, public.email_unsubscribe_tokens from public, anon, authenticated;
-- Os ids dos segredos no Vault não são expostos; os tokens de descadastro só por RPC.
grant select (organization_id, from_name, from_email, reply_to, domain_status, updated_at) on public.email_settings to authenticated;
create policy email_settings_member_select on public.email_settings for select to authenticated using (public.is_member(organization_id));

-- ---------------------------------------------------------------- configurações
-- resendKey/resendWebhookSecret ausentes ou vazios mantêm os segredos atuais. Trocar o remetente zera o status do domínio.
create function public.save_email_settings(p_org uuid, p_input jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare
  v_cur public.email_settings;
  v_key text := nullif(btrim(p_input->>'resendKey'),'');
  v_hook text := nullif(btrim(p_input->>'resendWebhookSecret'),'');
begin
  if not public.has_role(p_org,'admin') then raise exception 'forbidden' using errcode='42501'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' or coalesce(char_length(v_key),0)>8192 or coalesce(char_length(v_hook),0)>8192 then
    raise exception 'invalid email settings' using errcode='22023';
  end if;
  select * into v_cur from public.email_settings where organization_id=p_org for update;
  if v_key is not null then
    if v_cur.resend_key_secret_id is null then
      select vault.create_secret(v_key,'flowai-email-'||p_org||'-resend') into v_cur.resend_key_secret_id;
    else
      perform vault.update_secret(v_cur.resend_key_secret_id,v_key);
    end if;
  end if;
  if v_hook is not null then
    if v_cur.resend_webhook_secret_id is null then
      select vault.create_secret(v_hook,'flowai-email-'||p_org||'-webhook') into v_cur.resend_webhook_secret_id;
    else
      perform vault.update_secret(v_cur.resend_webhook_secret_id,v_hook);
    end if;
  end if;
  insert into public.email_settings(organization_id,from_name,from_email,reply_to,resend_key_secret_id,resend_webhook_secret_id)
    values(p_org,btrim(p_input->>'fromName'),lower(btrim(p_input->>'fromEmail')),lower(nullif(btrim(p_input->>'replyTo'),'')),
      v_cur.resend_key_secret_id,v_cur.resend_webhook_secret_id)
    on conflict (organization_id) do update set from_name=excluded.from_name, from_email=excluded.from_email,
      reply_to=excluded.reply_to, resend_key_secret_id=excluded.resend_key_secret_id,
      resend_webhook_secret_id=excluded.resend_webhook_secret_id,
      domain_status=case when public.email_settings.from_email=excluded.from_email then public.email_settings.domain_status end,
      updated_at=now();
end $$;

create function public.read_email_settings_secret(p_org uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('resendKey',k.decrypted_secret,'fromName',s.from_name,'fromEmail',s.from_email,'replyTo',s.reply_to)
  from public.email_settings s left join vault.decrypted_secrets k on k.id=s.resend_key_secret_id
  where s.organization_id=p_org;
$$;

create function public.record_email_domain_status(p_org uuid, p_status text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_status is null or p_status not in ('verified','pending','failed','not_found') then
    raise exception 'invalid domain status' using errcode='22023';
  end if;
  update public.email_settings set domain_status=p_status, updated_at=now() where organization_id=p_org;
end $$;

-- O webhook do Resend é um só por conta: o handler testa cada segredo.
create function public.read_resend_webhook_secrets() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('organizationId',s.organization_id,'secret',k.decrypted_secret) order by s.organization_id),'[]'::jsonb)
  from public.email_settings s join vault.decrypted_secrets k on k.id=s.resend_webhook_secret_id;
$$;

-- ---------------------------------------------------------------- reserva
-- Reserva até p_limit envios vencidos (ou presos em sending há mais de 5 min), revalida cada um e
-- cancela os que não devem sair. O destinatário é o contato ATUAL do carrinho e o e-mail ATUAL dele.
create function public.claim_email_sends(p_limit int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_out jsonb := '[]'::jsonb;
  e public.email_sends;
  s public.email_journey_steps;
  j public.email_journeys;
  c public.store_carts;
  k public.contacts;
  st public.email_settings;
  v_contact uuid;
  v_email text;
  v_key text;
  v_coupon text;
  v_token text;
  v_reason text;
begin
  select array_agg(id) into v_ids from (
    select id from public.email_sends
    where (state='scheduled' and send_at<=now()) or (state='sending' and claimed_at<now()-interval '5 minutes')
    order by send_at limit greatest(coalesce(p_limit,0),0)
    for update skip locked) x;

  foreach v_id in array coalesce(v_ids,'{}'::uuid[]) loop
    select * into e from public.email_sends where id=v_id;
    select * into s from public.email_journey_steps where id=e.step_id;
    select * into j from public.email_journeys where id=s.journey_id;
    select * into c from public.store_carts where id=e.cart_id;
    v_contact := coalesce(c.contact_id,e.contact_id);
    select * into k from public.contacts where id=v_contact;
    select * into st from public.email_settings where organization_id=e.organization_id;
    select decrypted_secret into v_key from vault.decrypted_secrets where id=st.resend_key_secret_id;
    v_email := lower(nullif(btrim(k.email),''));
    v_coupon := nullif(btrim(s.coupon),'');

    v_reason := case
      when not j.enabled or not s.enabled then 'step_disabled'
      when j.kind='cart' and exists(select 1 from public.store_orders o
        where o.organization_id=e.organization_id and o.contact_id=v_contact and o.paid_at>=e.created_at) then 'paid'
      when c.converted_at is not null then 'converted'
      when s.category='marketing' and k.email_marketing_opt_out_at is not null then 'unsubscribed'
      when v_email is null then 'no_email'
      when exists(select 1 from public.email_suppressions x
        where x.organization_id=e.organization_id and lower(x.email)=v_email) then 'suppressed'
      when nullif(btrim(c.recovery_url),'') is null then 'no_recovery_url'
      when v_coupon is null and concat_ws(' ',s.subject,s.heading,s.body) like '%{cupom}%' then 'no_coupon'
      when st.organization_id is null or coalesce(v_key,'')='' then 'no_settings'
    end;
    if v_reason is not null then
      update public.email_sends set state='cancelled', cancel_reason=v_reason, claimed_at=null where id=v_id;
      continue;
    end if;

    v_token := null;
    if s.category='marketing' then
      insert into public.email_unsubscribe_tokens(organization_id,contact_id) values(e.organization_id,v_contact)
        on conflict (contact_id) do nothing;
      select token into v_token from public.email_unsubscribe_tokens where contact_id=v_contact;
    end if;
    update public.email_sends set state='sending', claimed_at=now(), contact_id=v_contact, to_email=v_email where id=v_id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'sendId',v_id, 'toEmail',v_email, 'category',s.category,
      'content',jsonb_build_object('subject',s.subject,'heading',s.heading,'body',s.body,'buttonLabel',s.button_label,'coupon',v_coupon),
      'ctx',jsonb_build_object('storeName',st.from_name,'firstName',nullif(split_part(btrim(coalesce(k.name,'')),' ',1),''),
        'name',k.name,'total',c.total,'items',c.items,'buttonUrl',c.recovery_url,'unsubscribeToken',v_token),
      'from',st.from_name||' <'||st.from_email||'>', 'replyTo',st.reply_to, 'resendKey',v_key));
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------- conclusão
-- Só conclui envios em sending (uma conclusão repetida não faz nada). retry: 5/15/60 min; a 4ª falha.
create function public.complete_email_send(p_send uuid, p_result text, p_provider_id text, p_error text) returns void
language plpgsql security definer set search_path='' as $$
declare v_send public.email_sends;
begin
  if p_result is null or p_result not in ('sent','retry','failed') then
    raise exception 'invalid send result' using errcode='22023';
  end if;
  select * into v_send from public.email_sends where id=p_send for update;
  if not found or v_send.state<>'sending' then return; end if;
  if p_result='sent' then
    update public.email_sends set state='sent', sent_at=now(), provider_id=p_provider_id, error_code=null, claimed_at=null where id=p_send;
  elsif p_result='retry' and v_send.attempts<3 then
    update public.email_sends set state='scheduled', attempts=attempts+1, claimed_at=null, error_code=left(p_error,200),
      send_at=now()+make_interval(mins=>(array[5,15,60])[v_send.attempts+1]) where id=p_send;
  else
    update public.email_sends set state='failed', attempts=attempts+(p_result='retry')::int, claimed_at=null,
      error_code=left(coalesce(p_error,'failed'),200) where id=p_send;
  end if;
end $$;

-- ---------------------------------------------------------------- eventos do provedor
-- Carimba só a primeira ocorrência; bounce/reclamação suprimem o endereço. Outros tipos são ignorados.
create function public.record_email_event(p_provider_id text, p_type text, p_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare v_type text := substr(p_type,7); v_at timestamptz := coalesce(p_at,now()); v_org uuid; v_email text;
begin
  if p_type is null or p_type not in ('email.delivered','email.opened','email.clicked','email.bounced','email.complained') then
    return;
  end if;
  update public.email_sends set
    delivered_at=case when v_type='delivered' then coalesce(delivered_at,v_at) else delivered_at end,
    opened_at=case when v_type='opened' then coalesce(opened_at,v_at) else opened_at end,
    clicked_at=case when v_type='clicked' then coalesce(clicked_at,v_at) else clicked_at end,
    bounced_at=case when v_type='bounced' then coalesce(bounced_at,v_at) else bounced_at end
  where provider_id=p_provider_id
  returning organization_id, to_email into v_org, v_email;
  if found and v_type in ('bounced','complained') then
    insert into public.email_suppressions(organization_id,email,reason) values(v_org,lower(btrim(v_email)),v_type)
      on conflict do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------- descadastro
create function public.unsubscribe_email(p_token text) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_contact uuid;
begin
  select contact_id into v_contact from public.email_unsubscribe_tokens where token=p_token;
  if v_contact is null then return false; end if;
  update public.contacts set email_marketing_opt_out_at=coalesce(email_marketing_opt_out_at,now()) where id=v_contact;
  update public.email_sends e set state='cancelled', cancel_reason='unsubscribed'
    from public.email_journey_steps s
    where s.id=e.step_id and s.category='marketing' and e.contact_id=v_contact and e.state='scheduled';
  return true;
end $$;

-- ---------------------------------------------------------------- resultados
-- Envios criados na janela. Pedido recuperado: pedido pago do contato atribuído ao último envio
-- dele nos 7 dias anteriores ao pagamento (último toque).
create function public.email_journey_results(p_org uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_out jsonb;
begin
  if not public.is_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  with sends as (
    select * from public.email_sends where organization_id=p_org and created_at>=p_from and created_at<p_to
  ), counts as (
    select step_id, count(*) scheduled, count(sent_at) sent, count(delivered_at) delivered,
      count(opened_at) opened, count(clicked_at) clicked
    from sends group by step_id
  ), cancels as (
    select step_id, jsonb_object_agg(reason,n) obj
    from (select step_id, coalesce(cancel_reason,'unknown') reason, count(*) n from sends where state='cancelled' group by 1,2) t
    group by step_id
  ), recovered as (
    select x.step_id, count(*) n, sum(o.total) total
    from public.store_orders o
    cross join lateral (
      select e.step_id, e.created_at from public.email_sends e
      where e.organization_id=p_org and e.contact_id=o.contact_id
        and e.sent_at<=o.paid_at and e.sent_at>o.paid_at-interval '7 days'
      order by e.sent_at desc limit 1) x
    where o.organization_id=p_org and o.paid_at is not null and x.created_at>=p_from and x.created_at<p_to
    group by x.step_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('stepId',s.id,'position',s.position,
      'scheduled',coalesce(n.scheduled,0),'sent',coalesce(n.sent,0),'delivered',coalesce(n.delivered,0),
      'opened',coalesce(n.opened,0),'clicked',coalesce(n.clicked,0),'cancelled',coalesce(c.obj,'{}'::jsonb),
      'recoveredOrders',coalesce(r.n,0),'recoveredTotal',coalesce(r.total,0)) order by j.kind, s.position),'[]'::jsonb)
  into v_out
  from public.email_journey_steps s join public.email_journeys j on j.id=s.journey_id
  left join counts n on n.step_id=s.id left join cancels c on c.step_id=s.id left join recovered r on r.step_id=s.id
  where s.organization_id=p_org;
  return v_out;
end $$;

-- ---------------------------------------------------------------- cron
-- A cada minuto, no padrão de dispatch_meta_token_refresh (mesma configuração e segredo interno).
create function public.dispatch_email_worker() returns void
language plpgsql security definer set search_path='' as $$
declare config private.automation_worker_config; service_key text; worker_secret text;
begin
  select * into config from private.automation_worker_config;
  if not found then return; end if;
  select decrypted_secret into service_key from vault.decrypted_secrets where id=config.service_key_secret_id;
  select decrypted_secret into worker_secret from vault.decrypted_secrets where id=config.worker_secret_id;
  perform net.http_post(url := config.base_url || '/functions/v1/email-worker', body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key,
      'apikey', service_key, 'X-FlowAI-Worker', worker_secret), timeout_milliseconds := 55000);
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function public.save_email_settings(uuid,jsonb),
  public.read_email_settings_secret(uuid),
  public.record_email_domain_status(uuid,text),
  public.read_resend_webhook_secrets(),
  public.claim_email_sends(int),
  public.complete_email_send(uuid,text,text,text),
  public.record_email_event(text,text,timestamptz),
  public.unsubscribe_email(text),
  public.email_journey_results(uuid,timestamptz,timestamptz),
  public.dispatch_email_worker() from public,anon,authenticated;
grant execute on function public.read_email_settings_secret(uuid),
  public.record_email_domain_status(uuid,text),
  public.read_resend_webhook_secrets(),
  public.claim_email_sends(int),
  public.complete_email_send(uuid,text,text,text),
  public.record_email_event(text,text,timestamptz),
  public.dispatch_email_worker() to service_role;
grant execute on function public.save_email_settings(uuid,jsonb),
  public.email_journey_results(uuid,timestamptz,timestamptz) to authenticated;
grant execute on function public.unsubscribe_email(text) to anon, authenticated;

select cron.schedule('flowai-email-worker', '* * * * *', 'select public.dispatch_email_worker()');
