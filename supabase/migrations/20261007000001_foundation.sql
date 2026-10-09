-- Fundação: extensões, tipos e funções utilitárias compartilhadas.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pgmq;
create extension if not exists pg_cron;

create type public.org_role as enum ('owner', 'admin', 'agent', 'viewer');

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create function public.role_rank(r public.org_role)
returns int
language sql
immutable
set search_path = ''
as $$
  select case r
    when 'owner' then 4
    when 'admin' then 3
    when 'agent' then 2
    when 'viewer' then 1
  end;
$$;
