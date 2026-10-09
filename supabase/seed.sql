-- Helpers de teste (pgTAP). Executado apenas localmente em `db reset`.
create schema if not exists tests;
revoke all on schema tests from anon, authenticated;

create or replace function tests.create_user(p_email text, p_full_name text default 'Test User')
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    p_email, '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name),
    now(), now()
  );
  return v_id;
end;
$$;

create or replace function tests.authenticate_as(p_user uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function tests.clear_authentication()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function tests.create_org(p_owner uuid, p_name text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, name, slug)
  values (v_id, p_name, p_name || '-' || substr(md5(random()::text), 1, 8));
  insert into public.memberships (organization_id, user_id, role)
  values (v_id, p_owner, 'owner');
  return v_id;
end;
$$;

create or replace function tests.add_member(p_org uuid, p_user uuid, p_role public.org_role)
returns void
language plpgsql
as $$
begin
  insert into public.memberships (organization_id, user_id, role)
  values (p_org, p_user, p_role);
end;
$$;
