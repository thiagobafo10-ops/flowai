create or replace function public.guard_instagram_rule_media() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Disabling an unchanged target needs no remote credentials or fresh seal.
  if tg_op='UPDATE' and not new.active and new.media_id is not distinct from old.media_id then return new; end if;
  if new.media_id is not null and not exists(select 1 from public.instagram_verified_media v join public.channels ch on ch.id=v.channel_id
    join public.meta_connections mc on mc.id=ch.meta_connection_id where v.channel_id=new.channel_id and v.organization_id=new.organization_id
    and v.media_id=new.media_id and v.credential_generation=mc.credential_generation) then raise exception 'media not verified' using errcode='22023'; end if;
  return new;
end $$;
