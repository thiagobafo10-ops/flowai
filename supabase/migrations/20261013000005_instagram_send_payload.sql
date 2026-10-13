-- Preserve the Phase 5 lease/window rules and expose the stored Instagram body
-- to automation-worker and the shared send transport.
create or replace function public.claim_instagram_send(p_intent_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item public.instagram_send_intents; ch public.channels;
begin
  select * into item from public.instagram_send_intents where id=p_intent_id for update;
  if not found then return 'null'::jsonb; end if;
  if item.state='sending' and item.claimed_at<now()-interval '1 minute' then
    update public.instagram_send_intents set state='uncertain',error_code='expired_send_lease' where id=item.id;
    update public.messages set error='Envio sem confirmação. Verifique o Instagram antes de tentar novamente.' where id=item.message_id;
    return 'null'::jsonb;
  end if;
  if item.state<>'pending' then return 'null'::jsonb; end if;
  select * into ch from public.channels where id=item.channel_id;
  if ch.status<>'active' then raise exception 'channel inactive' using errcode='22023'; end if;
  if item.kind='direct' and not exists(select 1 from public.messages where conversation_id=item.conversation_id and direction='inbound' and created_at>now()-interval '24 hours') then raise exception 'messaging window closed' using errcode='22023'; end if;
  if item.kind='private_reply' and not exists(select 1 from public.instagram_events e join public.instagram_comment_rules r on r.id=e.rule_id
    where e.id=item.event_id and e.state='pending' and r.active and r.version=e.rule_version) then return 'null'::jsonb; end if;
  update public.instagram_send_intents set state='sending',claim_token=gen_random_uuid(),claimed_at=now() where id=item.id returning * into item;
  return jsonb_build_object('intentId',item.id,'channelId',ch.id,'connectionId',ch.meta_connection_id,'actorId',item.actor_id,
    'recipientExternalId',item.recipient_external_id,'commentId',item.comment_id,'kind',item.kind,'text',item.text,
    'messagePayload',item.message_payload,'claimToken',item.claim_token);
end $$;
revoke all on function public.claim_instagram_send(uuid) from public, anon, authenticated;
grant execute on function public.claim_instagram_send(uuid) to service_role;
