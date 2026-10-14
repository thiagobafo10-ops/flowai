import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { normalizeBrazilianPhone } from "@flowai/core";

// Apenas para e2e: acessa o Postgres do Supabase LOCAL via docker exec.
const DB_CONTAINER = "supabase_db_flowai";
const DOCKER_BIN = path.join(
  process.env.LOCALAPPDATA ?? "",
  "Programs",
  "DockerDesktop",
  "resources",
  "bin",
);

function readSupabaseUrl(): string {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return process.env.NEXT_PUBLIC_SUPABASE_URL;
  const envFile = path.join(__dirname, "..", "..", ".env.local");
  const m = fs.readFileSync(envFile, "utf8").match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m);
  return m?.[1]?.trim() ?? "";
}

export function assertLocalSupabase(): void {
  const url = readSupabaseUrl();
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {}
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`e2e abortado: Supabase não é local (${url || "URL ausente"}).`);
  }
}

export function psql(sql: string): string {
  assertLocalSupabase();
  const sep = process.platform === "win32" ? ";" : ":";
  return execFileSync(
    "docker",
    ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-tA", "-c", sql],
    { env: { ...process.env, PATH: `${DOCKER_BIN}${sep}${process.env.PATH}` }, encoding: "utf8" },
  ).trim();
}

export function clearRateLimits(): void {
  psql("delete from public.rate_limits");
}

export function countMemberships(email: string): number {
  if (!/^[\w.+@-]+$/.test(email)) throw new Error("e-mail inválido para helper");
  return Number(
    psql(
      `select count(*) from public.memberships m join auth.users u on u.id = m.user_id where u.email = '${email}'`,
    ),
  );
}

function assertEmail(email: string): void {
  if (!/^[\w.+@-]+$/.test(email)) throw new Error("e-mail inválido para helper");
}

export function countAuditLogins(email: string): number {
  assertEmail(email);
  return Number(
    psql(
      `select count(*) from public.audit_logs a join auth.users u on u.id = a.actor_id
       where u.email = '${email}' and a.action = 'auth.login' and a.organization_id is null
         and a.entity_type = 'user' and a.entity_id = u.id`,
    ),
  );
}

/**
 * Idempotente: garante os grants padrão que breakMembershipsRead/breakDashboardRpc revogam.
 * Uma execução interrompida pode pular o finally da fixture; o globalSetup restaura no início.
 */
export function ensureDefaultGrants(): void {
  restoreMembershipsRead();
  restoreDashboardRpc();
}

/** Simula falha do banco na leitura de memberships (somente Supabase local). */
export function breakMembershipsRead(): void {
  psql("revoke select on public.memberships from authenticated");
}

export function restoreMembershipsRead(): void {
  psql("grant select on public.memberships to authenticated");
}

/**
 * Cria, no org do usuário e como postgres, o cenário conhecido do dashboard
 * (3 contatos, 2 conversas, 2 deals). Os eventos vêm dos gatilhos de domínio.
 * Uma chamada por usuário novo.
 */
export function seedDashboardData(email: string): void {
  assertEmail(email);
  psql(`
do $$
declare
  v_org uuid;
  v_ch uuid;
  v_pipe uuid;
  c1 uuid; c2 uuid; c3 uuid;
  conv1 uuid; conv2 uuid;
begin
  select m.organization_id into v_org
    from public.memberships m join auth.users u on u.id = m.user_id
    where u.email = '${email}' limit 1;
  if v_org is null then raise exception 'org não encontrada para ${email}'; end if;

  insert into public.channels (organization_id, type, name, status)
    values (v_org, 'whatsapp', 'WhatsApp e2e', 'needs_setup') returning id into v_ch;
  select id into v_pipe from public.pipelines where organization_id = v_org and is_default;

  insert into public.contacts (organization_id, name) values (v_org, 'Contato 1') returning id into c1;
  insert into public.contacts (organization_id, name) values (v_org, 'Contato 2') returning id into c2;
  insert into public.contacts (organization_id, name) values (v_org, 'Contato 3') returning id into c3;
  update public.events set created_at = now() - interval '10 days'
    where organization_id = v_org and type = 'contact_created' and contact_id = c3;

  insert into public.conversations (organization_id, contact_id, channel_id)
    values (v_org, c1, v_ch) returning id into conv1;
  insert into public.conversations (organization_id, contact_id, channel_id)
    values (v_org, c2, v_ch) returning id into conv2;

  insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content) values
    (v_org, conv1, v_ch, 'inbound', 'contact', 'oi'),
    (v_org, conv1, v_ch, 'inbound', 'contact', 'tudo bem?'),
    (v_org, conv1, v_ch, 'outbound', 'ai', 'olá!'),
    (v_org, conv2, v_ch, 'inbound', 'contact', 'preço?');

  update public.conversations set status = 'pending_human' where id = conv2;
  update public.conversations set status = 'closed' where id = conv1;

  insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title, value)
    values (v_org, v_pipe, (select id from public.pipeline_stages where pipeline_id = v_pipe and name = 'Interessado'), c1, 'Deal A', 1000);
  insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title, value)
    values (v_org, v_pipe, (select id from public.pipeline_stages where pipeline_id = v_pipe and name = 'Novo'), c2, 'Deal B', 500);
  update public.deals set stage_id = (select id from public.pipeline_stages where pipeline_id = v_pipe and name = 'Ganho')
    where organization_id = v_org and title = 'Deal B';
end $$`);
}

/** Simula falha da RPC do dashboard (somente Supabase local). */
export function breakDashboardRpc(): void {
  psql("revoke execute on function public.dashboard_metrics(uuid, int) from authenticated");
}

export function restoreDashboardRpc(): void {
  psql("grant execute on function public.dashboard_metrics(uuid, int) to authenticated");
}

/** Cria `n` contatos manuais "Contato 01..n" na org do usuário (somente Supabase local). */
export function seedContacts(email: string, n: number): void {
  assertEmail(email);
  if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error("n inválido para helper");
  psql(`
do $$
declare v_org uuid;
begin
  select m.organization_id into v_org
    from public.memberships m join auth.users u on u.id = m.user_id
    where u.email = '${email}' limit 1;
  if v_org is null then raise exception 'org não encontrada para ${email}'; end if;
  insert into public.contacts (organization_id, name, source)
    select v_org, 'Contato ' || lpad(i::text, 2, '0'), 'manual' from generate_series(1, ${n}) i;
end $$`);
}

/** Apaga, como postgres, o deal com este título na org do usuário (somente Supabase local). */
export function deleteDealByTitle(email: string, title: string): void {
  assertEmail(email);
  // Título só com letras, números, espaços e pontuação comum; aspas simples são duplicadas.
  if (!/^[\p{L}\p{N} \-—.,:()]{1,120}$/u.test(title)) throw new Error("título inválido para helper");
  const escaped = title.replace(/'/g, "''");
  psql(`
delete from public.deals d
  using public.memberships m, auth.users u
  where u.email = '${email}' and m.user_id = u.id
    and d.organization_id = m.organization_id and d.title = '${escaped}'`);
}

/** Adiciona um usuário já cadastrado como membro da org do dono (somente Supabase local). */
export function addMember(ownerEmail: string, memberEmail: string, role: "viewer" | "agent" | "admin"): void {
  assertEmail(ownerEmail);
  assertEmail(memberEmail);
  if (!["viewer", "agent", "admin"].includes(role)) throw new Error("papel inválido para helper");
  psql(`
do $$
declare v_org uuid; v_user uuid;
begin
  select m.organization_id into v_org
    from public.memberships m join auth.users u on u.id = m.user_id
    where u.email = '${ownerEmail}' limit 1;
  select id into v_user from auth.users where email = '${memberEmail}';
  if v_org is null or v_user is null then raise exception 'org ou usuário não encontrado'; end if;
  insert into public.memberships (organization_id, user_id, role) values (v_org, v_user, '${role}');
end $$`);
}

// Nomes de contato/etapa/campo/título: letras, números, espaços e pontuação comum (aspas duplicadas).
function sqlText(value: string, what: string): string {
  if (!/^[\p{L}\p{N} \-—.,:()@+]{1,120}$/u.test(value)) throw new Error(`${what} inválido para helper`);
  return value.replace(/'/g, "''");
}

const orgOf = (email: string) => `(select m.organization_id from public.memberships m
    join auth.users u on u.id = m.user_id where u.email = '${email}' limit 1)`;

/** Id do contato com este nome na org do usuário (somente Supabase local). */
export function contactIdByName(email: string, name: string): string {
  assertEmail(email);
  return psql(
    `select id from public.contacts where organization_id = ${orgOf(email)} and name = '${sqlText(name, "nome")}' limit 1`,
  );
}

/** Grava um campo personalizado no contato, como postgres (simula outra pessoa editando). */
export function addCustomField(email: string, contactName: string, key: string, value: string): void {
  assertEmail(email);
  psql(`
insert into public.contact_custom_fields (organization_id, contact_id, key, value)
select c.organization_id, c.id, '${sqlText(key, "campo")}', '${sqlText(value, "valor")}'
  from public.contacts c
  where c.organization_id = ${orgOf(email)} and c.name = '${sqlText(contactName, "nome")}'`);
}

/** Cria (como postgres) um deal do contato na etapa, criando o contato se preciso. */
export function seedDeal(email: string, contactName: string, stageName: string, title: string): void {
  assertEmail(email);
  const contact = sqlText(contactName, "nome");
  psql(`
do $$
declare v_org uuid := ${orgOf(email)}; v_pipe uuid; v_contact uuid;
begin
  if v_org is null then raise exception 'org não encontrada'; end if;
  select id into v_pipe from public.pipelines where organization_id = v_org and is_default;
  select id into v_contact from public.contacts where organization_id = v_org and name = '${contact}' limit 1;
  if v_contact is null then
    insert into public.contacts (organization_id, name) values (v_org, '${contact}') returning id into v_contact;
  end if;
  insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title)
    values (v_org, v_pipe,
      (select id from public.pipeline_stages where pipeline_id = v_pipe and name = '${sqlText(stageName, "etapa")}'),
      v_contact, '${sqlText(title, "título")}');
end $$`);
}

/** Define o fuso da org e a última interação de um contato (somente Supabase local). */
export function setTimezoneAndLastInteraction(email: string, timezone: string, contactName: string, iso: string): void {
  assertEmail(email);
  if (!/^[A-Za-z_]+\/[A-Za-z_]+$/.test(timezone)) throw new Error("fuso inválido para helper");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(iso)) throw new Error("data inválida para helper");
  psql(`
update public.organizations set timezone = '${timezone}' where id = ${orgOf(email)};
update public.contacts set last_interaction_at = '${iso}'
  where organization_id = ${orgOf(email)} and name = '${sqlText(contactName, "nome")}'`);
}

/**
 * Simula, como postgres, uma mensagem recebida no canal Simulador da org do usuário
 * (criando e ativando o canal se preciso) via `ingest_inbound_message`.
 * O texto vai em dollar-quoting com tag aleatória: nunca interpolado como SQL.
 */
export function simulateInboundSql(
  email: string,
  input: { name: string | null; phone: string; text: string; externalId?: string },
): void {
  assertEmail(email);
  const phone = normalizeBrazilianPhone(input.phone);
  if (!phone) throw new Error("telefone inválido para helper");
  const tag = `t${Math.random().toString(36).slice(2, 10)}`;
  const dq = (v: string) => {
    if (v.includes(`$${tag}$`) || v.endsWith("$")) throw new Error("texto inválido para helper");
    return `$${tag}$${v}$${tag}$`;
  };
  const externalId = input.externalId ?? `sim_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  psql(`
do $body$
declare v_org uuid := ${orgOf(email)}; v_ch uuid;
begin
  if v_org is null then raise exception 'org não encontrada'; end if;
  select id into v_ch from public.channels where organization_id = v_org and type = 'simulator';
  if v_ch is null then
    insert into public.channels (organization_id, type, name, status)
      values (v_org, 'simulator', 'Simulador', 'active') returning id into v_ch;
  else
    update public.channels set status = 'active' where id = v_ch;
  end if;
  perform public.ingest_inbound_message(v_ch, ${dq(externalId)}, ${dq(phone)},
    ${input.name === null ? "null" : dq(input.name)}, ${dq(input.text)}, now());
end $body$`);
}
