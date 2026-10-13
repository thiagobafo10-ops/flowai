import { createServerClient } from "@/lib/supabase/server";
import type { AiAgentPayload, AiQuota } from "./types";

export type KnowledgeStatus = "processing" | "ready" | "error";
export type KnowledgeDocumentRow = {
  id: string;
  title: string;
  status: KnowledgeStatus;
  error: string | null;
  chunkCount: number;
  updatedAt: string;
};

/** Colunas explícitas: o conteúdo do documento não sai do banco para a listagem. */
export async function listKnowledgeDocuments(orgId: string): Promise<KnowledgeDocumentRow[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("knowledge_documents")
    .select("id, title, status, error, chunk_count, updated_at")
    .eq("organization_id", orgId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data.map((d) => ({
    id: d.id,
    title: d.title,
    status: d.status as KnowledgeStatus,
    error: d.error,
    chunkCount: d.chunk_count,
    updatedAt: d.updated_at,
  }));
}

/** Agente, uso do dia e documentos prontos da organização. */
export async function getAgentOverview(orgId: string): Promise<Omit<AiAgentPayload, "canWrite">> {
  const supabase = await createServerClient();
  const [agent, quota, docs] = await Promise.all([
    supabase.from("ai_agents").select("name, personality, objective, tone, system_prompt, is_active, auto_reply, human_handoff").eq("organization_id", orgId).maybeSingle(),
    supabase.rpc("ai_quota", { p_org: orgId }),
    supabase.from("knowledge_documents").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "ready"),
  ]);
  if (agent.error) throw agent.error;
  if (quota.error) throw quota.error;
  if (docs.error) throw docs.error;
  const q = quota.data as AiQuota;
  const a = agent.data;
  return {
    agent: a && {
      name: a.name, personality: a.personality, objective: a.objective, tone: a.tone, systemPrompt: a.system_prompt,
      isActive: a.is_active, autoReply: a.auto_reply, humanHandoff: a.human_handoff,
    },
    quota: { replies: q.replies, repliesLimit: q.repliesLimit, tests: q.tests, testsLimit: q.testsLimit },
    documentsReady: docs.count ?? 0,
  };
}
