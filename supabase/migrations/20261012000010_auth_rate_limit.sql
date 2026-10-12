-- check_rate_limit aceita qualquer chave: exposta a anon/authenticated, permitia
-- esgotar buckets de outros fluxos (ex.: meta:<conexão> do webhook) pela API
-- pública. Passa a ser só de servidor (service_role e funções definer).
revoke execute on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, int, int) to service_role;

-- Limites dos fluxos públicos de autenticação: tipo fechado e chave com namespace.
create function public.check_auth_rate_limit(p_kind text, p_subject text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_kind is null or p_kind not in ('signup', 'login') then
    raise exception 'invalid rate limit kind' using errcode = '22023';
  end if;
  if p_subject is null or length(p_subject) = 0 or length(p_subject) > 180 then
    raise exception 'invalid rate limit subject' using errcode = '22023';
  end if;
  return public.check_rate_limit(p_kind || ':' || p_subject, p_limit, p_window_seconds);
end $$;
revoke all on function public.check_auth_rate_limit(text, text, int, int) from public;
grant execute on function public.check_auth_rate_limit(text, text, int, int) to anon, authenticated, service_role;
