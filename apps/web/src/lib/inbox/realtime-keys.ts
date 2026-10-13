export type RealtimeTable = "messages" | "conversations" | "knowledge_documents";

/** Consultas a invalidar quando a tabela muda; cada área recarrega só o que é dela. */
export function realtimeInvalidations(table: RealtimeTable, orgId: string): string[][] {
  if (table === "knowledge_documents") return [["knowledge", orgId]];
  return [["inbox", orgId], ["conversation", orgId], ["unread", orgId], ["inbox-contact", orgId]];
}
