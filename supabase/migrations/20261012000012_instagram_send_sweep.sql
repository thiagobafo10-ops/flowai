-- Envios diretos não podem ficar presos: o lease de 1 min só era conferido
-- quando alguém tentava de novo, e intents órfãos (resposta HTTP perdida antes
-- do claim) ficavam pendentes para sempre.
alter table public.instagram_send_intents add column pending_since timestamptz not null default now();
comment on column public.instagram_send_intents.pending_since is
  'Início do estado pending atual (criação ou nova tentativa); a varredura falha intents órfãos após 10 min.';

create or replace function public.retry_instagram_send_intent(p_message_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare item public.instagram_send_intents; conv public.conversations;
begin
  select * into item from public.instagram_send_intents where message_id=p_message_id and kind='direct' for update;
  if not found or item.actor_id is distinct from auth.uid() or not public.has_role(item.organization_id,'agent')
    or item.state<>'failed' or item.error_code not in ('invalid_config','invalid_content','invalid_token','permission_denied','rate_limited','provider_rejected','not_dispatched') then
    raise exception 'retry forbidden' using errcode='42501';
  end if;
  select * into conv from public.conversations where id=item.conversation_id;
  if conv.status='closed' or not exists(select 1 from public.channels where id=item.channel_id and status='active')
    or not exists(select 1 from public.messages where conversation_id=conv.id and direction='inbound' and created_at>now()-interval '24 hours') then raise exception 'conversation unavailable' using errcode='22023'; end if;
  update public.instagram_send_intents set state='pending',claim_token=null,claimed_at=null,error_code=null,pending_since=now() where id=item.id;
  update public.messages set status='pending',error=null where id=p_message_id and status='failed';
  return item.id;
end $$;

create function public.sweep_instagram_send_intents() returns void
language plpgsql security definer set search_path='' as $$
declare item public.instagram_send_intents;
begin
  -- Lease vencido: o Graph pode ter recebido a mensagem; nunca reenviar sozinho.
  for item in update public.instagram_send_intents set state='uncertain',error_code='expired_send_lease'
      where kind='direct' and state='sending' and claimed_at<now()-interval '1 minute' returning * loop
    update public.messages set error='Envio sem confirmação. Verifique o Instagram antes de tentar novamente.'
      where id=item.message_id and status not in ('sent','delivered','read');
  end loop;
  -- Nunca reivindicado: nada foi enviado, então a falha é segura para nova tentativa.
  for item in update public.instagram_send_intents set state='failed',error_code='not_dispatched'
      where kind='direct' and state='pending' and pending_since<now()-interval '10 minutes' returning * loop
    update public.messages set status='failed',error='Não foi possível enviar pelo Instagram.'
      where id=item.message_id and status='pending';
  end loop;
end $$;
revoke all on function public.sweep_instagram_send_intents() from public,anon,authenticated;
grant execute on function public.sweep_instagram_send_intents() to service_role;

create index instagram_intents_direct_sweep_idx on public.instagram_send_intents(state, pending_since)
  where kind='direct' and state in ('pending','sending');

-- O cron de minuto também varre envios; sem trabalho visível na fila, não chama o worker.
create or replace function public.dispatch_instagram_worker() returns void
language plpgsql security definer set search_path='' as $$
declare config private.instagram_worker_config; service_key text; worker_secret text;
begin
  perform public.sweep_instagram_send_intents();
  select * into config from private.instagram_worker_config;
  if not found then return; end if;
  if not exists(select 1 from pgmq.q_instagram_work where vt<=clock_timestamp()) then return; end if;
  select decrypted_secret into service_key from vault.decrypted_secrets where id=config.service_key_secret_id;
  select decrypted_secret into worker_secret from vault.decrypted_secrets where id=config.worker_secret_id;
  perform net.http_post(url:=config.base_url||'/functions/v1/instagram-worker',body:='{}'::jsonb,
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||service_key,'apikey',service_key,'X-FlowAI-Worker',worker_secret),timeout_milliseconds:=150000);
end $$;
