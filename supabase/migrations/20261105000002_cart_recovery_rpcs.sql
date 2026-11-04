-- Recuperação unificada (entrega 1): RPCs do atendimento manual de carrinhos pelo WhatsApp.
-- Escrita só por aqui; o bloqueio é sempre revalidado com private.cart_whatsapp_block_reason.

-- ---------------------------------------------------------------- mensagem
-- Espelha renderWhatsappMessage/fillVariables (packages/core): variável vazia some com a vírgula órfã;
-- se o texto começava por ela, a primeira letra vira maiúscula. {itens} e {link} entram por último.
create function private.render_whatsapp_message(p_template text, p_first_name text, p_link text, p_total numeric,
  p_store text, p_items jsonb) returns text
language plpgsql immutable set search_path='' as $$
declare
  v_out text := p_template;
  v_cap boolean := false;
  v record;
begin
  for v in select * from (values
    (1,'primeiro_nome',coalesce(p_first_name,'')),
    (2,'nome',''),
    (3,'loja',coalesce(p_store,'')),
    (4,'cupom',''),
    (5,'valor',case when p_total is null then '' else
      'R$ '||translate(to_char(p_total,'FM999,999,999,990.00'),',.','.,') end)) t(n,k,val) order by n
  loop
    if v.val<>'' then v_out := replace(v_out,'{'||v.k||'}',v.val); continue; end if;
    if left(regexp_replace(v_out,'^\s+',''),char_length(v.k)+2)='{'||v.k||'}' then v_cap := true; end if;
    v_out := regexp_replace(regexp_replace(v_out,',\s*\{'||v.k||'\}','','g'),'\{'||v.k||'\}\s*,?\s*','','g');
  end loop;
  v_out := regexp_replace(v_out,'^\s+|\s+$','','g');
  if v_cap then v_out := upper(left(v_out,1))||substr(v_out,2); end if;
  return replace(replace(v_out,'{itens}',coalesce((
      select string_agg((i->>'quantity')||'x '||(i->>'name'),', ' order by o)
      from jsonb_array_elements(coalesce(p_items,'[]')) with ordinality x(i,o)),'')),
    '{link}',coalesce(p_link,''));
end $$;

-- Cópia de DEFAULT_WHATSAPP_TEMPLATE (packages/core/src/store/recovery.ts).
create function private.default_whatsapp_template() returns text
language sql immutable set search_path='' as $$
  select 'Oi, {primeiro_nome}! Aqui é da {loja}. Vi que você deixou algumas peças no carrinho e quis te ajudar a finalizar. Se tiver qualquer dúvida, é só me responder por aqui. Seu carrinho continua guardado neste link: {link}'::text
$$;

create function private.cart_whatsapp_message(p_cart uuid) returns text
language sql stable security definer set search_path='' as $$
  select private.render_whatsapp_message(
    coalesce(s.whatsapp_template,private.default_whatsapp_template()),
    nullif(split_part(btrim(coalesce(k.name,'')),' ',1),''),
    c.recovery_url, c.total, coalesce(e.from_name,o.name), c.items)
  from public.store_carts c
  join public.contacts k on k.id=c.contact_id
  join public.organizations o on o.id=c.organization_id
  left join public.cart_recovery_settings s on s.organization_id=c.organization_id
  left join public.email_settings e on e.organization_id=c.organization_id
  where c.id=p_cart
$$;

-- ---------------------------------------------------------------- helpers
-- Carrinho da organização, travado para serializar ações concorrentes; outra organização = 42501.
create function private.cart_for_operator(p_org uuid, p_cart uuid) returns public.store_carts
language plpgsql security definer set search_path='' as $$
declare c public.store_carts;
begin
  if not public.has_role(p_org,'agent') then raise exception 'forbidden' using errcode='42501'; end if;
  select * into c from public.store_carts where id=p_cart and organization_id=p_org for update;
  if not found then raise exception 'cart not found' using errcode='42501'; end if;
  return c;
end $$;

create function private.check_request_key(p_key text) returns void
language plpgsql immutable set search_path='' as $$
begin
  if coalesce(char_length(btrim(p_key)),0) not between 1 and 200 then
    raise exception 'invalid request_key' using errcode='22023';
  end if;
end $$;

-- Ação já gravada com a chave: mesmo conteúdo devolve o registro; outro conteúdo é conflito.
create function private.cart_action_replay(p_org uuid, p_key text, p_hash text) returns public.cart_contact_actions
language plpgsql stable security definer set search_path='' as $$
declare a public.cart_contact_actions;
begin
  select * into a from public.cart_contact_actions where organization_id=p_org and request_key=p_key;
  if found and a.request_hash<>p_hash then raise exception 'idempotency_conflict' using errcode='22023'; end if;
  return a;
end $$;

create function private.cart_action_hash(p_action text, p_cart uuid, p_note text, p_repeat boolean) returns text
language sql immutable set search_path='' as $$
  select md5(jsonb_build_array(p_action,p_cart,p_note,coalesce(p_repeat,false))::text)
$$;

create function private.cart_items_count(p_items jsonb) returns int
language sql immutable set search_path='' as $$
  select coalesce(sum(case when jsonb_typeof(i->'quantity')='number' then (i->>'quantity')::numeric else 1 end),0)::int
  from jsonb_array_elements(coalesce(p_items,'[]')) i
$$;

create function private.cart_unreconciled_payment(p_cart uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select c.commercial_status<>'paid' and exists(select 1 from public.store_orders o
    where o.organization_id=c.organization_id and o.contact_id=c.contact_id
      and o.paid_at>=coalesce(c.abandoned_at,c.created_at))
  from public.store_carts c where c.id=p_cart
$$;

-- ---------------------------------------------------------------- leitura
create function public.list_store_carts(p_org uuid, p_filters jsonb, p_page int, p_page_size int) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  f jsonb := coalesce(p_filters,'{}');
  v_q text := nullif(btrim(f->>'q'),'');
  v_out jsonb;
begin
  if not public.is_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if coalesce(p_page_size,0) not between 1 and 100 or coalesce(p_page,0)<1 then
    raise exception 'invalid page' using errcode='22023';
  end if;
  v_q := '%'||replace(replace(replace(v_q,'\','\\'),'%','\%'),'_','\_')||'%';
  with base as (
    select c.*, k.name as k_name, coalesce(c.abandoned_at,c.created_at) as ref_at,
      private.cart_whatsapp_block_reason(c.id) as block_reason
    from public.store_carts c join public.contacts k on k.id=c.contact_id
    where c.organization_id=p_org
      and (v_q is null or k.name ilike v_q or k.email ilike v_q or k.phone ilike v_q)
      and (f->>'from' is null or coalesce(c.abandoned_at,c.created_at)>=(f->>'from')::timestamptz)
      and (f->>'to' is null or coalesce(c.abandoned_at,c.created_at)<(f->>'to')::timestamptz)
      and (f->>'commercialStatus' is null or c.commercial_status=f->>'commercialStatus')
      and (f->>'recoveryStage' is null or c.recovery_stage=f->>'recoveryStage')
  ), filtered as (
    select * from base
    where f->>'eligible' is null or (block_reason is null)=(f->>'eligible')::boolean
  )
  select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((
    select jsonb_agg(jsonb_build_object('id',r.id,'customerName',r.k_name,
        'phoneValid',private.cart_whatsapp_phone(r.id) is not null,'total',r.total,
        'itemsCount',private.cart_items_count(r.items),'abandonedAt',r.abandoned_at,'receivedAt',r.created_at,
        'commercialStatus',r.commercial_status,'recoveryStage',r.recovery_stage,'paused',r.paused_at is not null,
        'unreconciledPayment',private.cart_unreconciled_payment(r.id),
        'blockReason',r.block_reason,'lastContactAt',r.last_contact_at) order by r.ref_at desc, r.id)
    from (select * from filtered order by ref_at desc, id limit p_page_size offset (p_page-1)*p_page_size) r),'[]'))
  into v_out;
  return v_out;
end $$;

create function public.get_store_cart(p_org uuid, p_cart uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  c public.store_carts;
  k public.contacts;
  v_hosts text[];
  v_phone text;
begin
  if not public.is_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select * into c from public.store_carts where id=p_cart and organization_id=p_org;
  if not found then raise exception 'cart not found' using errcode='42501'; end if;
  select * into k from public.contacts where id=c.contact_id;
  select checkout_hosts into v_hosts from public.store_connections where id=c.connection_id;
  v_phone := private.cart_whatsapp_phone(c.id);
  return jsonb_build_object(
    'id',c.id,'externalId',c.external_id,'total',c.total,'items',c.items,
    'abandonedAt',c.abandoned_at,'receivedAt',c.created_at,'convertedAt',c.converted_at,
    'commercialStatus',c.commercial_status,'recoveryStage',c.recovery_stage,
    'pausedAt',c.paused_at,'pauseReason',c.pause_reason,'closedAt',c.closed_at,'lastContactAt',c.last_contact_at,
    'recoveryUrlAllowed',private.checkout_url_allowed(c.recovery_url,v_hosts),
    'unreconciledPayment',private.cart_unreconciled_payment(c.id),
    'blockReason',private.cart_whatsapp_block_reason(c.id),
    'contact',jsonb_build_object('id',k.id,'name',k.name,'email',k.email,
      'phone',case when v_phone is not null
        then '+55 '||substr(v_phone,4,2)||' '||substr(v_phone,6,1)||'****-'||right(v_phone,4)
        when char_length(k.phone)>=4 then '****'||right(k.phone,4) end,
      'phoneValid',v_phone is not null,'blockedAt',k.contact_blocked_at,'blockedReason',k.contact_blocked_reason),
    'permission',(select jsonb_build_object('status',p.status,'source',p.source,'evidenceAt',p.evidence_at,'recordedAt',p.created_at)
      from public.contact_channel_permissions p where p.contact_id=c.contact_id and p.channel='whatsapp'
      order by p.created_at desc, p.id desc limit 1),
    'emails',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'stepPosition',s.position,'subject',s.subject,
        'state',e.state,'cancelReason',e.cancel_reason,'sendAt',e.send_at,'sentAt',e.sent_at,
        'deliveredAt',e.delivered_at,'openedAt',e.opened_at,'clickedAt',e.clicked_at,'bouncedAt',e.bounced_at)
        order by s.position, e.send_at)
      from public.email_sends e join public.email_journey_steps s on s.id=e.step_id where e.cart_id=c.id),'[]'),
    'actions',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'note',a.note,
        'actorName',pr.full_name,'createdAt',a.created_at) order by a.created_at, a.id)
      from public.cart_contact_actions a left join public.profiles pr on pr.id=a.actor_id where a.cart_id=c.id),'[]'));
end $$;

-- ---------------------------------------------------------------- configuração
create function public.save_cart_recovery_settings(p_org uuid, p_template text, p_checkout_hosts text[]) returns void
language plpgsql security definer set search_path='' as $$
declare v_hosts text[];
begin
  if not public.has_role(p_org,'admin') then raise exception 'forbidden' using errcode='42501'; end if;
  if coalesce(char_length(btrim(p_template)),0) not between 10 and 2000 then
    raise exception 'invalid template' using errcode='22023';
  end if;
  -- minúsculo, sem esquema, sem caminho/consulta, sem ponto final; linhas vazias ignoradas
  select coalesce(array_agg(distinct h order by h),'{}') into v_hosts from (
    select rtrim(split_part(split_part(split_part(regexp_replace(lower(btrim(x)),'^[a-z][a-z0-9+.-]*://',''),'/',1),'?',1),'#',1),'.') h
    from unnest(coalesce(p_checkout_hosts,'{}')) x) t
  where h<>'';
  if exists(select 1 from unnest(v_hosts) h where h !~ '^[a-z0-9.-]+\.[a-z]{2,}$') then
    raise exception 'invalid checkout host' using errcode='22023';
  end if;
  update public.store_connections set checkout_hosts=v_hosts where organization_id=p_org;
  if not found and v_hosts<>'{}' then raise exception 'store connection required' using errcode='22023'; end if;
  insert into public.cart_recovery_settings(organization_id,whatsapp_template,updated_by,updated_at)
    values(p_org,btrim(p_template),auth.uid(),now())
    on conflict (organization_id) do update set whatsapp_template=excluded.whatsapp_template,
      updated_by=excluded.updated_by, updated_at=excluded.updated_at;
end $$;

-- ---------------------------------------------------------------- atendimento
create function public.prepare_cart_whatsapp(p_org uuid, p_cart uuid, p_request_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  c public.store_carts := private.cart_for_operator(p_org,p_cart);
  v_reason text;
  v_hash text := private.cart_action_hash('opened_whatsapp',p_cart,null,false);
  a public.cart_contact_actions;
begin
  perform private.check_request_key(p_request_key);
  v_reason := private.cart_whatsapp_block_reason(c.id);
  if v_reason is not null then return jsonb_build_object('blocked',v_reason); end if;
  a := private.cart_action_replay(p_org,p_request_key,v_hash);
  if a.id is null then
    insert into public.cart_contact_actions(organization_id,cart_id,contact_id,actor_id,action,request_key,request_hash)
      values(p_org,c.id,c.contact_id,auth.uid(),'opened_whatsapp',p_request_key,v_hash) returning * into a;
  end if;
  return jsonb_build_object('phone',private.cart_whatsapp_phone(c.id),'message',private.cart_whatsapp_message(c.id),'actionId',a.id);
end $$;

create function public.record_cart_action(p_org uuid, p_cart uuid, p_action text, p_request_key text, p_note text,
  p_repeat boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  c public.store_carts := private.cart_for_operator(p_org,p_cart);
  v_note text := nullif(btrim(p_note),'');
  v_hash text;
  v_reason text;
  a public.cart_contact_actions;
begin
  perform private.check_request_key(p_request_key);
  if p_action is null or p_action not in ('marked_sent','reply_received','paused','resumed','closed','reopened','emails_stopped','note') then
    raise exception 'invalid action' using errcode='22023';
  end if;
  if (p_action in ('paused','note') and v_note is null) or char_length(v_note) not between 3 and 240
     or v_note ~* '[a-z][a-z0-9+.-]*://|www\.|token|secret|password' then
    raise exception 'invalid note' using errcode='22023';
  end if;
  v_hash := private.cart_action_hash(p_action,p_cart,v_note,p_repeat);
  a := private.cart_action_replay(p_org,p_request_key,v_hash);
  if a.id is not null then return jsonb_build_object('id',a.id,'action',a.action,'createdAt',a.created_at); end if;

  if p_action='marked_sent' then
    v_reason := private.cart_whatsapp_block_reason(c.id);
    if v_reason is not null then raise exception '%',v_reason using errcode='P0001'; end if;
    if not exists(select 1 from public.cart_contact_actions where cart_id=c.id and action='opened_whatsapp') then
      raise exception 'open_whatsapp_required' using errcode='P0001';
    end if;
    if not coalesce(p_repeat,false) and exists(select 1 from public.cart_contact_actions where cart_id=c.id and action='marked_sent') then
      raise exception 'repeat_confirmation_required' using errcode='P0001';
    end if;
    update public.store_carts set recovery_stage='waiting_reply', last_contact_at=now() where id=c.id;
  elsif p_action='reply_received' then
    update public.store_carts set recovery_stage='contacted' where id=c.id and recovery_stage<>'closed';
  elsif p_action='paused' then
    update public.store_carts set paused_at=coalesce(paused_at,now()), pause_reason=v_note where id=c.id;
  elsif p_action='resumed' then
    update public.store_carts set paused_at=null, pause_reason=null where id=c.id;
  elsif p_action='closed' then
    update public.store_carts set recovery_stage='closed', closed_at=coalesce(closed_at,now()) where id=c.id;
  elsif p_action='reopened' then
    update public.store_carts set recovery_stage='new', closed_at=null where id=c.id;
  elsif p_action='emails_stopped' then
    update public.email_sends set state='cancelled', cancel_reason='paused_by_operator'
      where cart_id=c.id and state='scheduled';
  end if;

  insert into public.cart_contact_actions(organization_id,cart_id,contact_id,actor_id,action,note,request_key,request_hash)
    values(p_org,c.id,c.contact_id,auth.uid(),p_action,v_note,p_request_key,v_hash) returning * into a;
  return jsonb_build_object('id',a.id,'action',a.action,'createdAt',a.created_at);
end $$;

create function public.record_contact_permission(p_org uuid, p_contact uuid, p_status text, p_source text,
  p_evidence_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not public.has_role(p_org,'agent') then raise exception 'forbidden' using errcode='42501'; end if;
  perform 1 from public.contacts where id=p_contact and organization_id=p_org;
  if not found then raise exception 'contact not found' using errcode='42501'; end if;
  if p_status is null or p_status not in ('granted','revoked') or coalesce(char_length(btrim(p_source)),0) not between 3 and 240
     or p_evidence_at is null or p_evidence_at>now() then
    raise exception 'invalid permission' using errcode='22023';
  end if;
  insert into public.contact_channel_permissions(organization_id,contact_id,channel,status,source,evidence_at,recorded_by)
    values(p_org,p_contact,'whatsapp',p_status,btrim(p_source),p_evidence_at,auth.uid()) returning id into v_id;
  return v_id;
end $$;

create function public.set_contact_blocked(p_org uuid, p_contact uuid, p_blocked boolean, p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.has_role(p_org,'agent') then raise exception 'forbidden' using errcode='42501'; end if;
  perform 1 from public.contacts where id=p_contact and organization_id=p_org for update;
  if not found then raise exception 'contact not found' using errcode='42501'; end if;
  if p_blocked is null or (p_blocked and coalesce(char_length(btrim(p_reason)),0) not between 3 and 240) then
    raise exception 'invalid block' using errcode='22023';
  end if;
  if not p_blocked then
    update public.contacts set contact_blocked_at=null, contact_blocked_reason=null where id=p_contact;
    return;
  end if;
  update public.contacts set contact_blocked_at=coalesce(contact_blocked_at,now()), contact_blocked_reason=btrim(p_reason)
    where id=p_contact;
  update public.email_sends set state='cancelled', cancel_reason='unsubscribed'
    where contact_id=p_contact and state='scheduled';
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function private.render_whatsapp_message(text,text,text,numeric,text,jsonb),
  private.default_whatsapp_template(),
  private.cart_whatsapp_message(uuid),
  private.cart_for_operator(uuid,uuid),
  private.check_request_key(text),
  private.cart_action_replay(uuid,text,text),
  private.cart_action_hash(text,uuid,text,boolean),
  private.cart_items_count(jsonb),
  private.cart_unreconciled_payment(uuid) from public,anon,authenticated;
revoke all on function public.list_store_carts(uuid,jsonb,int,int),
  public.get_store_cart(uuid,uuid),
  public.save_cart_recovery_settings(uuid,text,text[]),
  public.prepare_cart_whatsapp(uuid,uuid,text),
  public.record_cart_action(uuid,uuid,text,text,text,boolean),
  public.record_contact_permission(uuid,uuid,text,text,timestamptz),
  public.set_contact_blocked(uuid,uuid,boolean,text) from public,anon;
grant execute on function public.list_store_carts(uuid,jsonb,int,int),
  public.get_store_cart(uuid,uuid),
  public.save_cart_recovery_settings(uuid,text,text[]),
  public.prepare_cart_whatsapp(uuid,uuid,text),
  public.record_cart_action(uuid,uuid,text,text,text,boolean),
  public.record_contact_permission(uuid,uuid,text,text,timestamptz),
  public.set_contact_blocked(uuid,uuid,boolean,text) to authenticated;
