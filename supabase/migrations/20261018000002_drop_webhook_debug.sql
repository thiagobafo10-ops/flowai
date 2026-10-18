-- Fim do diagnóstico temporário dos comentários em anúncio:
-- remove a captura de payloads brutos do webhook (continha dados das pessoas).

drop table if exists public.webhook_debug;
