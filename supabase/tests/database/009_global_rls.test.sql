begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select is((select array_agg(c.relname::text order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity), null, 'todas as tabelas de public têm RLS');

select is((select array_agg(c.relname::text order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p')
    and c.relname not in ('organizations','profiles','rate_limits','audit_logs')
    and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'organization_id'
                    and a.attnotnull and not a.attisdropped)), null, 'organization_id NOT NULL em toda tabela tenant');

select is((select count(*)::int from pg_policies where schemaname = 'public' and 'anon' = any(roles)), 0, 'nenhuma policy para anon');

select is((select array_agg(distinct table_name::text order by table_name::text) from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon','authenticated') and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')),
  null, 'sem TRUNCATE/REFERENCES/TRIGGER para anon/authenticated');

select is((select array_agg(p.oid::regprocedure::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and not coalesce((select bool_or(c like 'search_path=%') from unnest(p.proconfig) c), false)), null, 'SECURITY DEFINER com search_path fixo');

select is((select array_agg(p.oid::regprocedure::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.proname not in ('check_auth_rate_limit', 'open_tracked_link')
    and has_function_privilege('anon', p.oid, 'execute')), null,
  'anon não executa SECURITY DEFINER (exceto check_auth_rate_limit e open_tracked_link, a rota pública /r/<código>)');

select * from finish();
rollback;
