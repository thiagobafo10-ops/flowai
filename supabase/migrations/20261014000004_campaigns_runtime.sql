-- Fase 7B: audience resolution, snapshot, channel pacing, cancellation and reports.
-- Every audience reference is resolved within p_org. One selected conversation per contact:
-- prefer a channel with an open window, then the most recently created conversation.
create function private.campaign_in_window(p_org uuid, p_conversation uuid, p_channel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select ch.type = 'simulator' or (ch.type = 'instagram' and exists (
    select 1 from public.messages m where m.organization_id = p_org
      and m.conversation_id = p_conversation and m.channel_id = ch.id
      and m.direction = 'inbound' and m.sender_type = 'contact' and not m.is_internal_note
      and m.created_at >= now() - interval '24 hours' and m.created_at <= now()
  )) from public.channels ch where ch.organization_id = p_org and ch.id = p_channel), false)
$$;

create function private.campaign_audience(p_org uuid, p_audience jsonb)
returns table(contact_id uuid, conversation_id uuid, channel_id uuid, in_window boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.valid_campaign_audience(p_org, p_audience) then
    raise exception 'invalid_audience' using errcode = '22023';
  end if;
  return query
  select k.id, chosen.id, chosen.channel_id, chosen.in_window
  from public.contacts k
  join lateral (
    select c.id, c.channel_id, private.campaign_in_window(p_org, c.id, c.channel_id) as in_window
    from public.conversations c where c.organization_id = p_org and c.contact_id = k.id
      and p_audience -> 'channelIds' @> jsonb_build_array(c.channel_id)
    order by in_window desc, c.created_at desc, c.id desc limit 1
  ) chosen on true
  where k.organization_id = p_org
    and not exists (
      select 1 from jsonb_array_elements_text(coalesce(p_audience -> 'tagsAll', '[]')) t
      where not exists (select 1 from public.contact_tags ct
        where ct.organization_id = p_org and ct.contact_id = k.id and ct.tag_id = t::uuid))
    and (jsonb_array_length(coalesce(p_audience -> 'tagsAny', '[]')) = 0 or exists (
      select 1 from public.contact_tags ct where ct.organization_id = p_org and ct.contact_id = k.id
        and p_audience -> 'tagsAny' @> jsonb_build_array(ct.tag_id)))
    and not exists (select 1 from public.contact_tags ct
      where ct.organization_id = p_org and ct.contact_id = k.id
        and coalesce(p_audience -> 'tagsNone', '[]') @> jsonb_build_array(ct.tag_id))
    and (jsonb_array_length(coalesce(p_audience -> 'stageIds', '[]')) = 0 or exists (
      select 1 from public.deals d where d.organization_id = p_org and d.contact_id = k.id
        and p_audience -> 'stageIds' @> jsonb_build_array(d.stage_id)))
    and (p_audience ->> 'minLeadScore' is null or k.lead_score >= (p_audience ->> 'minLeadScore')::int)
    and (p_audience ->> 'lastInteractionDays' is null
      or k.last_interaction_at >= now() - make_interval(days => (p_audience ->> 'lastInteractionDays')::int))
    and (jsonb_array_length(coalesce(p_audience -> 'entryLinkIds', '[]')) = 0 or exists (
      select 1 from public.entry_link_hits h where h.organization_id = p_org and h.contact_id = k.id
        and p_audience -> 'entryLinkIds' @> jsonb_build_array(h.link_id)));
end $$;

create function public.preview_campaign_audience(p_org uuid, p_audience jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_member(p_org) then raise exception 'organization_not_found' using errcode = 'P0002'; end if;
  return (select jsonb_build_object('total', count(*), 'inWindow', count(*) filter (where a.in_window),
    'outOfWindow', count(*) filter (where not a.in_window)) from private.campaign_audience(p_org, p_audience) a);
end $$;

create function public.schedule_campaign(p_id uuid, p_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare v_campaign public.campaigns;
begin
  select * into v_campaign from public.campaigns where id = p_id and public.is_member(organization_id) for update;
  if not found then raise exception 'campaign_not_found' using errcode = 'P0002'; end if;
  if not public.has_role(v_campaign.organization_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_campaign.status <> 'draft' then raise exception 'campaign_not_draft' using errcode = '22023'; end if;
  if not private.valid_campaign_audience(v_campaign.organization_id, v_campaign.audience) then
    raise exception 'invalid_audience' using errcode = '22023';
  end if;
  if not private.valid_outreach_message(v_campaign.message) then raise exception 'invalid_message' using errcode = '22023'; end if;
  update public.campaigns set status = 'scheduled', scheduled_at = coalesce(p_at, now()) where id = p_id;
end $$;

-- Shared terminal hook for Task 7. Lock order is always campaign before delivery.
-- Cancelled campaigns stay cancelled even when an already sending delivery finishes.
create function private.campaign_maybe_complete(p_campaign uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_campaign public.campaigns;
begin
  select * into v_campaign from public.campaigns where id = p_campaign for update;
  if not found or v_campaign.status <> 'sending' then return; end if;
  if not exists (select 1 from public.outreach_deliveries d where d.organization_id = v_campaign.organization_id
      and d.campaign_id = p_campaign and d.status in ('pending', 'sending')) then
    update public.campaigns set status = 'completed', finished_at = now() where id = p_campaign;
  end if;
end $$;

create function public.cancel_campaign(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_campaign public.campaigns;
begin
  select * into v_campaign from public.campaigns where id = p_id and public.is_member(organization_id) for update;
  if not found then raise exception 'campaign_not_found' using errcode = 'P0002'; end if;
  if not public.has_role(v_campaign.organization_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_campaign.status in ('completed', 'cancelled') then return; end if;
  update public.outreach_deliveries set status = 'cancelled', reason = 'campaign_cancelled', claim_token = null, claimed_until = null
    where organization_id = v_campaign.organization_id and campaign_id = p_id and status = 'pending';
  update public.campaigns set status = 'cancelled', finished_at = now() where id = p_id;
  perform private.campaign_maybe_complete(p_id);
end $$;

create function private.start_due_campaigns() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_campaign public.campaigns;
  v_channel uuid;
  v_rate int;
  v_spacing interval;
  v_base timestamptz;
  v_audience jsonb;
  v_channels jsonb;
  v_campaign_ids uuid[];
begin
  select campaign_rate_per_minute into v_rate from private.outreach_settings where singleton;
  v_spacing := interval '1 minute' / v_rate;
  -- Claim the full due batch first, then lock its complete channel union in global UUID order.
  -- Per-campaign sorting alone can reverse lock order across campaigns in the same transaction.
  select coalesce(array_agg(due.id), '{}') into v_campaign_ids from (
    select id from public.campaigns where status = 'scheduled' and scheduled_at <= now()
      order by scheduled_at, id for update skip locked
  ) due;
  perform ch.id from public.channels ch where exists (
    select 1 from public.campaigns c where c.id = any(v_campaign_ids) and c.organization_id = ch.organization_id
      and c.audience -> 'channelIds' @> jsonb_build_array(ch.id)
  ) order by ch.id for update;
  for v_campaign in select * from public.campaigns where id = any(v_campaign_ids) order by scheduled_at, id loop
    update public.campaigns set status = 'sending', started_at = now() where id = v_campaign.id;
    -- Selected channels are JSON references: a disconnect can delete one after scheduling.
    -- Drop only missing channels in a runtime copy; existing foreign channels remain invalid.
    if not private.is_uuid_array(v_campaign.audience -> 'channelIds', 1) or exists (
      select 1 from public.channels ch where ch.organization_id <> v_campaign.organization_id
        and v_campaign.audience -> 'channelIds' @> jsonb_build_array(ch.id)
    ) then raise exception 'invalid_audience' using errcode = '22023'; end if;
    select coalesce(jsonb_agg(ch.id order by ch.id), '[]') into v_channels from public.channels ch
      where ch.organization_id = v_campaign.organization_id
        and v_campaign.audience -> 'channelIds' @> jsonb_build_array(ch.id);
    -- Materialize once: every recipient and window decision belongs to the same snapshot.
    if jsonb_array_length(v_channels) = 0 then
      v_audience := '[]';
    else
      select coalesce(jsonb_agg(to_jsonb(a)), '[]') into v_audience
        from private.campaign_audience(v_campaign.organization_id,
          jsonb_set(v_campaign.audience, '{channelIds}', v_channels)) a;
    end if;
    -- The channel union is already locked, serializing pacing across concurrent campaigns.
    -- Pending/sending/sent CAMPAIGN deliveries reserve slots; future sequence steps do not.
    -- Sent slots preserve spacing between consecutive campaigns; cancellation frees unused slots.
    for v_channel in select ch.id from public.channels ch where ch.organization_id = v_campaign.organization_id
        and v_campaign.audience -> 'channelIds' @> jsonb_build_array(ch.id) order by ch.id loop
      select greatest(now(), max(d.run_after) + v_spacing) into v_base from public.outreach_deliveries d
        where d.organization_id = v_campaign.organization_id and d.channel_id = v_channel
          and d.source = 'campaign' and d.status in ('pending', 'sending', 'sent');
      insert into public.outreach_deliveries(organization_id, source, campaign_id, contact_id, channel_id,
        conversation_id, run_after, status, reason)
      select v_campaign.organization_id, 'campaign', v_campaign.id, a.contact_id, a.channel_id, a.conversation_id,
        case when a.in_window then v_base + (count(*) filter (where a.in_window) over (order by a.contact_id) - 1) * v_spacing
          else now() end,
        case when a.in_window then 'pending' else 'skipped' end,
        case when a.in_window then null else 'window_closed' end
      from jsonb_to_recordset(v_audience) as a(contact_id uuid, conversation_id uuid, channel_id uuid, in_window boolean)
      where a.channel_id = v_channel
      on conflict (campaign_id, contact_id) where campaign_id is not null do nothing;
    end loop;
    perform private.campaign_maybe_complete(v_campaign.id);
  end loop;
end $$;

create function public.campaign_report(p_id uuid, p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_campaign public.campaigns; v_counts jsonb; v_clicks jsonb; v_recipients jsonb;
begin
  select * into v_campaign from public.campaigns where id = p_id and public.is_member(organization_id);
  if not found then raise exception 'campaign_not_found' using errcode = 'P0002'; end if;
  if p_limit is null or p_offset is null or p_limit not between 1 and 100 or p_offset < 0 then
    raise exception 'invalid_pagination' using errcode = '22023';
  end if;
  with deliveries as (
    select d.status, d.reason from public.outreach_deliveries d
      where d.organization_id = v_campaign.organization_id and d.campaign_id = p_id
  ), reasons as (
    select status, coalesce(reason, 'unknown') as reason, count(*) as n from deliveries
      where status in ('skipped', 'failed') group by status, coalesce(reason, 'unknown')
  ) select jsonb_build_object('sent', (select count(*) from deliveries where status = 'sent'),
      'cancelled', (select count(*) from deliveries where status = 'cancelled'),
      'skipped', coalesce((select jsonb_object_agg(reason, n) from reasons where status = 'skipped'), '{}'),
      'failed', coalesce((select jsonb_object_agg(reason, n) from reasons where status = 'failed'), '{}')) into v_counts;
  select coalesce(jsonb_object_agg(clicks.option_id, clicks.n), '{}') into v_clicks from (
    select e.payload ->> 'optionId' as option_id, count(*) as n from public.events e
    join public.outreach_deliveries d on e.payload ->> 'deliveryId' = d.id::text
      and d.organization_id = e.organization_id
    where e.organization_id = v_campaign.organization_id and d.campaign_id = p_id and e.type = 'outreach_click'
      and e.payload ->> 'optionId' ~ '^[a-z0-9]{1,12}$'
    group by e.payload ->> 'optionId'
  ) clicks;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at, r.id), '[]') into v_recipients from (
    select d.id, d.contact_id, k.name as contact_name, d.channel_id, d.conversation_id, d.status, d.reason,
      d.run_after, d.message_id, d.created_at
    from public.outreach_deliveries d left join public.contacts k on k.id = d.contact_id and k.organization_id = d.organization_id
    where d.organization_id = v_campaign.organization_id and d.campaign_id = p_id
    order by d.created_at, d.id limit p_limit offset p_offset
  ) r;
  return jsonb_build_object('counts', v_counts, 'clicks', v_clicks, 'recipients', v_recipients);
end $$;

revoke all on function private.campaign_in_window(uuid, uuid, uuid), private.campaign_audience(uuid, jsonb),
  private.campaign_maybe_complete(uuid), private.start_due_campaigns() from public, anon, authenticated;
revoke all on function public.preview_campaign_audience(uuid, jsonb), public.schedule_campaign(uuid, timestamptz),
  public.cancel_campaign(uuid), public.campaign_report(uuid, int, int) from public, anon;
grant execute on function public.preview_campaign_audience(uuid, jsonb), public.schedule_campaign(uuid, timestamptz),
  public.cancel_campaign(uuid), public.campaign_report(uuid, int, int) to authenticated;
