create table public.instagram_verified_media (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_id uuid not null,
  media_id text not null check(media_id ~ '^[0-9]{1,100}$'),
  credential_generation integer not null,
  verified_at timestamptz not null default now(),
  primary key(channel_id,media_id),
  foreign key(organization_id,channel_id) references public.channels(organization_id,id)
);
alter table public.instagram_verified_media enable row level security;
revoke all on public.instagram_verified_media from anon,authenticated;
create function public.verify_instagram_media(p_connection_id uuid,p_channel_id uuid,p_media_id text,p_generation integer) returns void
language plpgsql security definer set search_path='' as $$
declare ch public.channels; generation integer;
begin
  select * into ch from public.channels where id=p_channel_id and meta_connection_id=p_connection_id;
  if ch.id is null then raise exception 'connection not owned' using errcode='42501'; end if;
  select credential_generation into generation from public.meta_connections where id=p_connection_id for share;
  if generation is distinct from p_generation then raise exception 'stale credentials' using errcode='40001'; end if;
  insert into public.instagram_verified_media(organization_id,channel_id,media_id,credential_generation)
    values(ch.organization_id,ch.id,p_media_id,p_generation) on conflict(channel_id,media_id) do update set credential_generation=excluded.credential_generation,verified_at=now();
end $$;
create function public.guard_instagram_rule_media() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.media_id is not null and not exists(select 1 from public.instagram_verified_media v join public.channels ch on ch.id=v.channel_id
    join public.meta_connections mc on mc.id=ch.meta_connection_id where v.channel_id=new.channel_id and v.organization_id=new.organization_id
    and v.media_id=new.media_id and v.credential_generation=mc.credential_generation) then raise exception 'media not verified' using errcode='22023'; end if;
  return new;
end $$;
create trigger instagram_rule_media before insert or update on public.instagram_comment_rules for each row execute function public.guard_instagram_rule_media();
revoke all on function public.guard_instagram_rule_media() from public,anon,authenticated;
revoke all on function public.verify_instagram_media(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.verify_instagram_media(uuid,uuid,text,integer) to service_role;
