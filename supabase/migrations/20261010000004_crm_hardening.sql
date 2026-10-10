-- Endurecimento do CRM (revisão final da Fase 3).

-- Pipelines: um por organização, criado por create_organization_with_owner. A API só renomeia;
-- criar, excluir ou trocar o padrão contornaria os invariantes das funções de etapa.
revoke insert, delete on public.pipelines from authenticated;
revoke update (is_default) on public.pipelines from authenticated;
-- update (name) continua concedido (20261007000004_crm.sql).

-- Contatos: a identidade do canal (origem, ids externos, última interação) é escrita
-- só pelo backend dos canais (service role / código definer), nunca pela API do usuário.
revoke update (source, whatsapp_id, instagram_id, last_interaction_at) on public.contacts from authenticated;
-- Mantém explicitamente as colunas editáveis pelo app.
grant update (name, phone, email, avatar_url, status, lead_score, assigned_to) on public.contacts to authenticated;
