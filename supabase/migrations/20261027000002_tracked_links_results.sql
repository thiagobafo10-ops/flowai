-- Links rastreáveis (/r/<código>) para botões de link das automações, resultados por automação e listagem de
-- contatos para o MCP.
--
-- Onde o botão de link vira `web_url` (todos os caminhos que chegam à Meta):
-- * private.automation_deliver (sobre 000004): mensagens do motor. O worker monta o corpo do Instagram
--   (toInstagramMessage) com a URL do grafo; a URL é trocada aqui, no ponto em que a intenção de envio é gravada,
--   e o worker de envio só repassa message_payload.
-- * private.instagram_comment_body (sobre 000006): primeira resposta privada do comentário.
-- * private.outreach_instagram_body (campanhas/sequências): sem execução de automação, fica sem rastreio
--   (automation_deliver recebe p_run nulo e mantém o corpo).

-- ---------------------------------------------------------------- tabelas
-- run_id não tem FK: a resposta privada do comentário reserva o id da execução no evento
-- (instagram_events.automation_run_id) e só cria a linha em automation_runs no claim do envio.
create table public.tracked_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null unique check (code ~ '^[a-z0-9]{12}$'),
  automation_id uuid not null,
  run_id uuid not null,
  contact_id uuid,
  button_title text not null check (char_length(button_title) between 1 and 80),
  url text not null check (url ~ '^https://' and char_length(url) <= 2048),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (run_id, automation_id, button_title, url),
  foreign key (organization_id, automation_id) references public.automations (organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete set null (contact_id)
);
create index tracked_links_automation_idx on public.tracked_links (automation_id);
create index tracked_links_contact_idx on public.tracked_links (organization_id, contact_id) where contact_id is not null;

create table public.tracked_link_clicks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  link_id uuid not null,
  clicked_at timestamptz not null default now(),
  foreign key (organization_id, link_id) references public.tracked_links (organization_id, id) on delete cascade
);
create index tracked_link_clicks_link_idx on public.tracked_link_clicks (link_id, clicked_at);
create index tracked_link_clicks_org_idx on public.tracked_link_clicks (organization_id, clicked_at);

alter table public.tracked_links enable row level security;
alter table public.tracked_link_clicks enable row level security;
revoke all on public.tracked_links, public.tracked_link_clicks from public, anon, authenticated;
grant select (id, organization_id, code, automation_id, run_id, contact_id, button_title, url, created_at)
  on public.tracked_links to authenticated;
grant select (id, organization_id, link_id, clicked_at) on public.tracked_link_clicks to authenticated;
create policy tracked_links_member_select on public.tracked_links for select to authenticated
  using (public.is_member(organization_id));
create policy tracked_link_clicks_member_select on public.tracked_link_clicks for select to authenticated
  using (public.is_member(organization_id));

-- Origem pública do app (sem barra final). Nulo desliga o rastreio (os botões mantêm a URL original).
create table private.tracked_link_settings (
  singleton boolean primary key default true check (singleton),
  base_url text check (base_url ~ '^https://[a-z0-9.-]+(:[0-9]{1,5})?$')
);
alter table private.tracked_link_settings enable row level security;
revoke all on private.tracked_link_settings from public, anon, authenticated;
insert into private.tracked_link_settings (singleton, base_url) values (true, 'https://flowai-web-rust.vercel.app');

-- Apoio às consultas: execução reservada no evento do comentário, DMs do motor e respostas privadas no período.
create index instagram_events_automation_run_idx on public.instagram_events (automation_run_id)
  where automation_run_id is not null;
create index messages_automation_created_idx on public.messages (organization_id, created_at)
  where sender_type = 'automation' and direction = 'outbound';
create index instagram_intents_private_reply_created_idx on public.instagram_send_intents (organization_id, created_at)
  where kind = 'private_reply';

-- ---------------------------------------------------------------- geração do link
create function private.generate_tracked_code() returns text
language sql volatile set search_path = '' as $$
  select string_agg(substr('abcdefghijklmnopqrstuvwxyz0123456789', (get_byte(b, i) % 36) + 1, 1), '' order by i)
  from (select extensions.gen_random_bytes(12) as b) x, generate_series(0, 11) i
$$;

-- <base_url>/r/<código> para o botão (mesmo código para a mesma execução + automação + título + URL). Sem base,
-- sem execução conhecida ou com URL fora do formato: devolve p_url (nunca impede o envio).
create function private.tracked_button_url(p_run uuid, p_title text, p_url text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_base text; v_org uuid; v_auto uuid; v_contact uuid; v_code text; v_try int := 0;
begin
  if p_run is null or p_title is null or p_url is null or p_url !~ '^https://' or char_length(p_url) > 2048
     or char_length(p_title) not between 1 and 80 then
    return p_url;
  end if;
  select s.base_url into v_base from private.tracked_link_settings s;
  if v_base is null then return p_url; end if;
  select r.organization_id, r.automation_id, r.contact_id into v_org, v_auto, v_contact
    from public.automation_runs r where r.id = p_run;
  if v_auto is null then
    -- resposta privada do comentário: execução ainda só reservada no evento
    select e.organization_id, e.automation_id into v_org, v_auto
      from public.instagram_events e
      where e.automation_run_id = p_run and e.kind = 'comment' and e.automation_id is not null
      limit 1;
  end if;
  if v_auto is null then return p_url; end if;
  loop
    select l.code into v_code from public.tracked_links l
      where l.run_id = p_run and l.automation_id = v_auto and l.button_title = p_title and l.url = p_url;
    if v_code is not null then return v_base || '/r/' || v_code; end if;
    v_try := v_try + 1;
    if v_try > 5 then return p_url; end if;
    -- conflito de código (improvável) ou inserção concorrente do mesmo botão: a volta seguinte resolve
    insert into public.tracked_links (organization_id, code, automation_id, run_id, contact_id, button_title, url)
      values (v_org, private.generate_tracked_code(), v_auto, p_run, v_contact, p_title, p_url)
      on conflict do nothing;
  end loop;
end $$;

-- Troca a URL dos botões web_url de um corpo do Instagram pelo link rastreável da execução.
create function private.tracked_instagram_body(p_run uuid, p_body jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_buttons jsonb; b jsonb; v_out jsonb := '[]'::jsonb;
begin
  if p_run is null or jsonb_typeof(p_body) is distinct from 'object' then return p_body; end if;
  v_buttons := p_body #> '{attachment,payload,buttons}';
  if jsonb_typeof(v_buttons) is distinct from 'array' then return p_body; end if;
  for b in select x from jsonb_array_elements(v_buttons) with ordinality t(x, i) order by i loop
    if jsonb_typeof(b) = 'object' and b ->> 'type' = 'web_url' and jsonb_typeof(b -> 'url') = 'string' then
      b := jsonb_set(b, '{url}', to_jsonb(private.tracked_button_url(p_run, b ->> 'title', b ->> 'url')));
    end if;
    v_out := v_out || jsonb_build_array(b);
  end loop;
  return jsonb_set(p_body, '{attachment,payload,buttons}', v_out);
end $$;

-- ---------------------------------------------------------------- construtores web_url
-- Sobre 000004 (mesmo corpo): o message_payload do Instagram passa por private.tracked_instagram_body.
create or replace function private.automation_deliver(p_run uuid, p_conv public.conversations, p_node uuid, p_text text,
  p_buttons jsonb, p_quick_replies jsonb, p_instagram jsonb, p_ai_metadata jsonb, out result text, out intent_id uuid)
language plpgsql security definer set search_path = '' as $$
declare v_type public.channel_type; v_message uuid; v_recipient text; v_context jsonb;
begin
  select ch.type into v_type from public.channels ch where ch.id = p_conv.channel_id;
  v_context := jsonb_build_object('automation', jsonb_build_object('runId', p_run, 'nodeId', p_node,
    'buttons', coalesce(p_buttons, '[]'::jsonb), 'quickReplies', coalesce(p_quick_replies, '[]'::jsonb)));
  if v_type = 'instagram' then
    select k.instagram_id into v_recipient from public.contacts k
      where k.id = p_conv.contact_id and k.organization_id = p_conv.organization_id;
    insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content, status,
        context, ai_metadata)
      values (p_conv.organization_id, p_conv.id, p_conv.channel_id, 'outbound', 'automation', p_text, 'pending',
        v_context, p_ai_metadata)
      returning id into v_message;
    insert into public.instagram_send_intents (organization_id, channel_id, conversation_id, message_id, actor_id,
        request_id, recipient_external_id, text, message_payload, automation_run_id)
      values (p_conv.organization_id, p_conv.channel_id, p_conv.id, v_message, null, null, v_recipient, p_text,
        private.tracked_instagram_body(p_run, p_instagram), p_run)
      returning id into intent_id;
    result := 'queued';
    return;
  end if;
  insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content, status,
      context, ai_metadata)
    values (p_conv.organization_id, p_conv.id, p_conv.channel_id, 'outbound', 'automation', p_text, 'delivered',
      v_context, p_ai_metadata);
  result := 'sent';
end $$;

-- Sobre 000006 (mesmo corpo): volatile (grava o link) e URL do botão via private.tracked_button_url.
create or replace function private.instagram_comment_body(p_run uuid,p_node jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare cfg jsonb:=p_node->'config'; txt text; opts jsonb; b jsonb; arr jsonb:='[]';
begin
  if cfg->>'mode' is distinct from 'text' then return null; end if;
  txt:=private.automation_render_null_name(cfg->>'text');
  opts:=private.automation_node_payloads(p_run,p_node);
  if jsonb_array_length(coalesce(cfg->'buttons','[]'))>0 then
    for b in select * from jsonb_array_elements(cfg->'buttons') loop
      arr:=arr||jsonb_build_array(case when b->>'kind'='url' then
        jsonb_build_object('type','web_url','url',private.tracked_button_url(p_run,b->>'title',b->>'url'),'title',b->>'title') else
        jsonb_build_object('type','postback','title',b->>'title','payload',opts->> (b->>'id')) end);
    end loop;
    return jsonb_build_object('attachment',jsonb_build_object('type','template','payload',
      jsonb_build_object('template_type','button','text',txt,'buttons',arr)));
  elsif jsonb_array_length(coalesce(cfg->'quickReplies','[]'))>0 then
    for b in select * from jsonb_array_elements(cfg->'quickReplies') loop
      arr:=arr||jsonb_build_array(jsonb_build_object('content_type','text','title',b->>'title','payload',opts->> (b->>'id')));
    end loop;
    return jsonb_build_object('text',txt,'quick_replies',arr);
  end if;
  return jsonb_build_object('text',txt);
end $$;

-- ---------------------------------------------------------------- abrir link (rota pública /r/<código>)
-- Código fora do padrão ou inexistente: null. Registra o clique (até 30 por minuto por código; acima disso a URL
-- ainda é devolvida, sem registro) e devolve a URL guardada.
create function public.open_tracked_link(p_code text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare l public.tracked_links;
begin
  if p_code is null or p_code !~ '^[a-z0-9]{12}$' then return null; end if;
  select * into l from public.tracked_links where code = p_code;
  if not found then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('tracked_link:' || l.id::text, 0));
  if (select count(*) from public.tracked_link_clicks c
      where c.link_id = l.id and c.clicked_at > now() - interval '1 minute') < 30 then
    insert into public.tracked_link_clicks (organization_id, link_id) values (l.organization_id, l.id);
  end if;
  return l.url;
end $$;

-- ---------------------------------------------------------------- resultados por automação
-- [{automationId, name, status, runs, dmsSent, publicReplies, clicks:{total, byButton:{título:n}}, uniqueContacts}]
-- no período [p_from, p_to] (máx. 90 dias), por automação da organização (ou só p_automation), ordenado por nome:
-- * runs: execuções criadas no período; uniqueContacts: contatos distintos dessas execuções.
-- * dmsSent: mensagens do motor (messages.context.automation.runId de uma execução da automação, status sent,
--   delivered ou read) criadas no período + respostas privadas do comentário (instagram_send_intents
--   kind private_reply, state sent, com automation_run_id) criadas no período.
-- * publicReplies: instagram_comment_public_replies em state sent criadas no período.
-- * clicks: cliques em links rastreáveis (tracked_link_clicks) + eventos button_clicked (botões de caminho e
--   respostas rápidas, payload {runId, nodeId, optionId}) no período; byButton pelo título do botão (o da versão
--   da execução; sem título, o optionId).
create function public.automation_results(p_org uuid, p_from timestamptz, p_to timestamptz,
  p_automation uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_out jsonb;
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_org is null or not public.is_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > interval '90 days' then
    raise exception 'invalid_period' using errcode = '22023';
  end if;

  with autos as (
    select a.id, a.name, a.status from public.automations a
      where a.organization_id = p_org and (p_automation is null or a.id = p_automation)
  ), run_stats as (
    select r.automation_id, count(*) as runs, count(distinct r.contact_id) as contacts
      from public.automation_runs r join autos a on a.id = r.automation_id
      where r.organization_id = p_org and r.created_at between p_from and p_to
      group by r.automation_id
  ), dm_msgs as (
    select r.automation_id, count(*) as n
      from (select case when m.context -> 'automation' ->> 'runId' ~ v_uuid
                     then (m.context -> 'automation' ->> 'runId')::uuid end as run_id
              from public.messages m
              where m.organization_id = p_org and m.sender_type = 'automation' and m.direction = 'outbound'
                and m.created_at between p_from and p_to and m.status in ('sent', 'delivered', 'read')) x
      join public.automation_runs r on r.id = x.run_id and r.organization_id = p_org
      join autos a on a.id = r.automation_id
      group by r.automation_id
  ), dm_private as (
    select r.automation_id, count(*) as n
      from public.instagram_send_intents i
      join public.automation_runs r on r.id = i.automation_run_id and r.organization_id = p_org
      join autos a on a.id = r.automation_id
      where i.organization_id = p_org and i.kind = 'private_reply' and i.state = 'sent'
        and i.created_at between p_from and p_to
      group by r.automation_id
  ), public_replies as (
    select p.automation_id, count(*) as n
      from public.instagram_comment_public_replies p join autos a on a.id = p.automation_id
      where p.organization_id = p_org and p.state = 'sent' and p.created_at between p_from and p_to
      group by p.automation_id
  ), click_rows as (
    select l.automation_id, l.button_title as title
      from public.tracked_link_clicks c
      join public.tracked_links l on l.id = c.link_id
      join autos a on a.id = l.automation_id
      where c.organization_id = p_org and c.clicked_at between p_from and p_to
    union all
    select r.automation_id, coalesce(t.title, x.option_id) as title
      from (select case when e.payload ->> 'runId' ~ v_uuid then (e.payload ->> 'runId')::uuid end as run_id,
                   e.payload ->> 'nodeId' as node_id, e.payload ->> 'optionId' as option_id
              from public.events e
              where e.organization_id = p_org and e.type = 'button_clicked'
                and e.created_at between p_from and p_to) x
      join public.automation_runs r on r.id = x.run_id and r.organization_id = p_org
      join autos a on a.id = r.automation_id
      left join public.automation_versions v on v.automation_id = r.automation_id and v.version = r.version
      left join lateral (
        select o ->> 'title' as title
          from jsonb_array_elements(case when jsonb_typeof(v.graph -> 'nodes') = 'array' then v.graph -> 'nodes'
                                         else '[]'::jsonb end) n,
               jsonb_array_elements(
                 (case when jsonb_typeof(n -> 'config' -> 'buttons') = 'array' then n -> 'config' -> 'buttons'
                       else '[]'::jsonb end)
                 || (case when jsonb_typeof(n -> 'config' -> 'quickReplies') = 'array' then n -> 'config' -> 'quickReplies'
                          else '[]'::jsonb end)) o
          where n ->> 'id' = x.node_id and o ->> 'id' = x.option_id
          limit 1) t on true
      where x.option_id is not null
  ), click_titles as (
    select automation_id, title, count(*) as n from click_rows group by automation_id, title
  ), clicks as (
    select automation_id, sum(n)::bigint as total, jsonb_object_agg(title, n) as by_button
      from click_titles group by automation_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'automationId', a.id,
      'name', a.name,
      'status', a.status,
      'runs', coalesce(rs.runs, 0),
      'dmsSent', coalesce(dm.n, 0) + coalesce(dp.n, 0),
      'publicReplies', coalesce(pr.n, 0),
      'clicks', jsonb_build_object('total', coalesce(ck.total, 0), 'byButton', coalesce(ck.by_button, '{}'::jsonb)),
      'uniqueContacts', coalesce(rs.contacts, 0)) order by a.name, a.id), '[]'::jsonb)
    into v_out
    from autos a
    left join run_stats rs on rs.automation_id = a.id
    left join dm_msgs dm on dm.automation_id = a.id
    left join dm_private dp on dp.automation_id = a.id
    left join public_replies pr on pr.automation_id = a.id
    left join clicks ck on ck.automation_id = a.id;
  return v_out;
end $$;

-- ---------------------------------------------------------------- contatos para o MCP
-- [{id, name, username, lastInteractionAt, automations:[nome]}], ordenado pela última interação (mais recente
-- primeiro). username: senderName do comentário mais recente do contato no Instagram (null sem comentário).
-- p_search (literal, sem curingas) compara nome ou username sem maiúsculas; p_automation: contatos com execução
-- dessa automação. automations: nomes distintos das automações com execução para o contato, em ordem alfabética.
create function public.mcp_contacts(p_org uuid, p_search text, p_automation uuid, p_limit int) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_pattern text; v_out jsonb;
begin
  if p_org is null or not public.is_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid_limit' using errcode = '22023';
  end if;
  v_pattern := nullif(btrim(left(coalesce(p_search, ''), 100)), '');
  if v_pattern is not null then
    v_pattern := '%' || replace(replace(replace(v_pattern, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with base as (
    select k.id, k.name, k.last_interaction_at, k.created_at, u.username
      from public.contacts k
      left join lateral (
        select e.payload ->> 'senderName' as username
          from public.instagram_events e
          where k.instagram_id is not null and e.organization_id = p_org and e.kind = 'comment'
            and e.payload ->> 'senderExternalId' = k.instagram_id and coalesce(e.payload ->> 'senderName', '') <> ''
          order by e.created_at desc
          limit 1) u on true
      where k.organization_id = p_org
        and (p_automation is null or exists (
          select 1 from public.automation_runs r
            where r.automation_id = p_automation and r.contact_id = k.id and r.organization_id = p_org))
        and (v_pattern is null or k.name ilike v_pattern escape '\' or u.username ilike v_pattern escape '\')
      order by k.last_interaction_at desc nulls last, k.created_at desc, k.id
      limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id,
      'name', b.name,
      'username', b.username,
      'lastInteractionAt', b.last_interaction_at,
      'automations', coalesce((
        select jsonb_agg(s.name order by s.name)
          from (select distinct a.name from public.automation_runs r
                  join public.automations a on a.id = r.automation_id
                  where r.organization_id = p_org and r.contact_id = b.id) s), '[]'::jsonb))
      order by b.last_interaction_at desc nulls last, b.created_at desc, b.id), '[]'::jsonb)
    into v_out
    from base b;
  return v_out;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function private.generate_tracked_code(), private.tracked_button_url(uuid, text, text),
  private.tracked_instagram_body(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.open_tracked_link(text) from public;
grant execute on function public.open_tracked_link(text) to anon, authenticated;
revoke all on function public.automation_results(uuid, timestamptz, timestamptz, uuid),
  public.mcp_contacts(uuid, text, uuid, int) from public, anon;
grant execute on function public.automation_results(uuid, timestamptz, timestamptz, uuid),
  public.mcp_contacts(uuid, text, uuid, int) to authenticated;
