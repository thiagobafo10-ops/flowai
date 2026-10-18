-- TEMPORÁRIO (diagnóstico): captura dos payloads brutos recebidos da Meta no webhook.
-- Existe apenas para isolar por que comentários em anúncio não disparam a automação;
-- é removida com uma migration de drop assim que a causa estiver identificada.

create table public.webhook_debug (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  method text not null,
  url text,
  headers jsonb,
  body jsonb
);
alter table public.webhook_debug enable row level security;
revoke all on public.webhook_debug from public,anon,authenticated;
create index webhook_debug_created_at_idx on public.webhook_debug (created_at desc);
