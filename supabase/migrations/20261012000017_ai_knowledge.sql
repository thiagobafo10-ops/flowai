-- Fase 6 (IA): base de conhecimento com fila de indexação e busca vetorial.

-- ---------------------------------------------------------------- colunas
alter table public.knowledge_documents
  add column generation int not null default 1,
  add column chunk_count int not null default 0;

-- As escritas passam por save/reprocess (admin) e pelo worker; delete segue pela policy de admin.
revoke insert, update on public.knowledge_documents from authenticated;
drop policy knowledge_documents_insert on public.knowledge_documents;
drop policy knowledge_documents_update on public.knowledge_documents;

alter publication supabase_realtime add table public.knowledge_documents;

-- ---------------------------------------------------------------- reinício da indexação
-- Apaga os chunks, cancela a tarefa pendente anterior e cria a da geração informada.
-- Tarefa em execução de geração antiga fica como está: o worker a descarta pela checagem de geração.
create function private.restart_document_indexing(p_org uuid, p_doc uuid, p_generation int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.knowledge_chunks where organization_id = p_org and document_id = p_doc;
  -- Reaproveita a tarefa pendente existente (sem corrida com o índice único parcial).
  insert into public.ai_jobs (organization_id, kind, document_id, document_generation)
    values (p_org, 'index_document', p_doc, p_generation)
    on conflict (document_id) where kind = 'index_document' and state = 'pending'
    do update set document_generation = excluded.document_generation, run_after = now(), attempts = 0,
      last_error = null, claim_token = null, claimed_until = null;
end $$;

-- ---------------------------------------------------------------- escrita (admin)
create function public.save_knowledge_document(p_org uuid, p_id uuid, p_title text, p_content text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_title text; v_id uuid; v_gen int;
begin
  if not public.has_role(p_org, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  v_title := btrim(coalesce(p_title, ''));
  if char_length(v_title) not between 1 and 200 then
    raise exception 'invalid title' using errcode = '22023';
  end if;
  if p_content is null or p_content !~ '\S' or char_length(p_content) > 200000 then
    raise exception 'invalid content' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.knowledge_documents (organization_id, title, content)
      values (p_org, v_title, p_content) returning id, generation into v_id, v_gen;
  else
    update public.knowledge_documents
      set title = v_title, content = p_content, status = 'processing', error = null, chunk_count = 0,
          generation = generation + 1
      where id = p_id and organization_id = p_org returning id, generation into v_id, v_gen;
    if not found then raise exception 'document not found' using errcode = 'P0002'; end if;
  end if;
  perform private.restart_document_indexing(p_org, v_id, v_gen);
  return v_id;
end $$;

create function public.reprocess_knowledge_document(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_gen int;
begin
  select d.organization_id into v_org from public.knowledge_documents d where d.id = p_id;
  if v_org is null or not public.has_role(v_org, 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.knowledge_documents
    set status = 'processing', error = null, chunk_count = 0, generation = generation + 1
    where id = p_id returning generation into v_gen;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.restart_document_indexing(v_org, p_id, v_gen);
end $$;

-- ---------------------------------------------------------------- worker
create function public.prepare_index_document(p_job uuid, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job public.ai_jobs; doc public.knowledge_documents;
begin
  if p_token is null then return null; end if;
  select * into job from public.ai_jobs
    where id = p_job and kind = 'index_document' and state = 'running' and claim_token = p_token for update;
  if not found then return null; end if;
  select * into doc from public.knowledge_documents
    where id = job.document_id and organization_id = job.organization_id;
  if not found or doc.generation is distinct from job.document_generation then
    update public.ai_jobs set state = 'cancelled', claim_token = null, claimed_until = null where id = job.id;
    return null;
  end if;
  return jsonb_build_object('documentId', doc.id, 'organizationId', doc.organization_id,
    'generation', doc.generation, 'title', doc.title, 'content', doc.content);
end $$;

create function public.complete_index_document(p_job uuid, p_token uuid, p_chunks jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare job public.ai_jobs; doc public.knowledge_documents; c jsonb; v_count int;
begin
  if p_token is null then raise exception 'invalid claim' using errcode = '42501'; end if;
  select * into job from public.ai_jobs
    where id = p_job and kind = 'index_document' and state = 'running' and claim_token = p_token for update;
  if not found then
    -- Documento apagado durante a indexação: a tarefa sumiu por cascata.
    if not exists (select 1 from public.ai_jobs where id = p_job) then return 'stale'; end if;
    raise exception 'invalid claim' using errcode = '42501';
  end if;
  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array' then
    raise exception 'invalid chunks' using errcode = '22023';
  end if;
  -- valida tudo antes de qualquer escrita
  for c in select value from jsonb_array_elements(p_chunks) loop
    if jsonb_typeof(c) <> 'object'
      or jsonb_typeof(c->'index') <> 'number' or (c->>'index') !~ '^[0-9]{1,9}$'
      or jsonb_typeof(c->'content') <> 'string' or c->>'content' = ''
      or coalesce(jsonb_typeof(c->'tokenCount'), 'number') <> 'number'
      or coalesce(c->>'tokenCount', '0') !~ '^[0-9]{1,9}$'
      or jsonb_typeof(c->'embedding') <> 'array' or jsonb_array_length(c->'embedding') <> 1536
      or exists (select 1 from jsonb_array_elements(c->'embedding') x where jsonb_typeof(x) <> 'number') then
      raise exception 'invalid chunk' using errcode = '22023';
    end if;
  end loop;
  if (select count(distinct (e.value->>'index')::int) from jsonb_array_elements(p_chunks) e) <> jsonb_array_length(p_chunks) then
    raise exception 'duplicate chunk index' using errcode = '22023';
  end if;
  select * into doc from public.knowledge_documents
    where id = job.document_id and organization_id = job.organization_id for update;
  if not found or doc.generation is distinct from job.document_generation then
    update public.ai_jobs set state = 'cancelled', claim_token = null, claimed_until = null where id = job.id;
    return 'stale';
  end if;
  delete from public.knowledge_chunks where organization_id = doc.organization_id and document_id = doc.id;
  insert into public.knowledge_chunks (organization_id, document_id, chunk_index, content, token_count, embedding)
    select doc.organization_id, doc.id, (e.value->>'index')::int, e.value->>'content',
      coalesce((e.value->>'tokenCount')::int, 0), (e.value->'embedding')::text::extensions.vector(1536)
    from jsonb_array_elements(p_chunks) e;
  get diagnostics v_count = row_count;
  update public.knowledge_documents set status = 'ready', error = null, chunk_count = v_count where id = doc.id;
  update public.ai_jobs set state = 'done', claim_token = null, claimed_until = null, last_error = null where id = job.id;
  return 'done';
end $$;

-- Chamado por fail_ai_job ao esgotar as tentativas. Nunca pode levantar erro.
create or replace function private.ai_job_gave_up(job public.ai_jobs) returns void
language plpgsql security definer set search_path = '' as $$
begin
  begin
    if job.kind = 'index_document' then
      update public.knowledge_documents d
        set status = 'error',
            error = case when job.last_error = 'not_configured' then 'IA não configurada na plataforma'
                         else 'Não foi possível processar o documento. Tente reprocessar.' end
        where d.id = job.document_id and d.organization_id = job.organization_id
          and d.generation = job.document_generation;
    end if;
  exception when others then
    raise warning 'ai_job_gave_up: job % failed with SQLSTATE %', job.id, sqlstate;
  end;
end $$;

-- ---------------------------------------------------------------- busca
create function public.match_knowledge_chunks(p_org uuid, p_embedding extensions.vector(1536),
  p_k int default 5, p_min_similarity float default 0.3)
returns table (id uuid, document_id uuid, document_title text, content text, similarity float)
language plpgsql security definer set search_path = '' as $$
begin
  if p_embedding is null or extensions.vector_dims(p_embedding) <> 1536 then
    raise exception 'invalid embedding' using errcode = '22023';
  end if;
  -- consulta de norma zero não tem direção: sem resultados
  if extensions.vector_norm(p_embedding) = 0 then return; end if;
  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  return query
    with cand as materialized (
      select c.id, c.document_id, d.title, c.content,
        (1 - (c.embedding operator(extensions.<=>) p_embedding))::float as sim
      from public.knowledge_chunks c
      join public.knowledge_documents d on d.organization_id = c.organization_id and d.id = c.document_id
      where c.organization_id = p_org and d.status = 'ready'
      order by c.embedding operator(extensions.<=>) p_embedding
      limit greatest(coalesce(p_k, 5), 0)
    )
    select cand.id, cand.document_id, cand.title, cand.content, cand.sim
    from cand
    where cand.sim = cand.sim and cand.sim >= coalesce(p_min_similarity, 0.3)
    order by cand.sim desc;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function
  private.restart_document_indexing(uuid, uuid, int),
  public.save_knowledge_document(uuid, uuid, text, text),
  public.reprocess_knowledge_document(uuid),
  public.prepare_index_document(uuid, uuid),
  public.complete_index_document(uuid, uuid, jsonb),
  public.match_knowledge_chunks(uuid, extensions.vector, int, float)
  from public, anon, authenticated;
grant execute on function
  public.save_knowledge_document(uuid, uuid, text, text),
  public.reprocess_knowledge_document(uuid)
  to authenticated, service_role;
grant execute on function
  public.prepare_index_document(uuid, uuid),
  public.complete_index_document(uuid, uuid, jsonb),
  public.match_knowledge_chunks(uuid, extensions.vector, int, float)
  to service_role;
