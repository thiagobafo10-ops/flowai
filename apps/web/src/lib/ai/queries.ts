import { createServerClient } from "@/lib/supabase/server";

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
