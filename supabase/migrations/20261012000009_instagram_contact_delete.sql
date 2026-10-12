-- Deleting a CRM contact already cascades through conversations/messages.
-- Internal send intents must follow that same lifecycle, not block deletion.
do $$
declare constraint_name text;
begin
  select conname into constraint_name from pg_catalog.pg_constraint
    where conrelid='public.instagram_send_intents'::regclass and confrelid='public.conversations'::regclass;
  execute format('alter table public.instagram_send_intents drop constraint %I',constraint_name);
end $$;
alter table public.instagram_send_intents add constraint instagram_intents_conversation_fk
  foreign key(organization_id,conversation_id,channel_id) references public.conversations(organization_id,id,channel_id) on delete cascade;
