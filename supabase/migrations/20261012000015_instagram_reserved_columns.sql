-- "Último resultado" de cada regra lê o evento mais recente por regra.
create index instagram_events_rule_latest_idx on public.instagram_events(rule_id, created_at desc)
  where rule_id is not null;

-- Colunas da Fase 2 que a integração Instagram NÃO usa: os segredos do app e o
-- verify token ficam em meta_connections (Vault), por conexão.
comment on column public.channels.app_secret_secret_id is
  'Reservada/não usada. Instagram guarda o App Secret em meta_connections.app_secret_id (Vault).';
comment on column public.channels.verify_token_secret_id is
  'Reservada/não usada. Instagram guarda o verify token em meta_connections.verify_token_secret_id (Vault).';
comment on column public.channels.waba_id is
  'Reservada para a integração WhatsApp (adiada); não usada pelo Instagram.';
comment on column public.channels.access_token_secret_id is
  'Id do token de acesso no Vault (Instagram: por canal/conta). Nunca exposto ao frontend.';
