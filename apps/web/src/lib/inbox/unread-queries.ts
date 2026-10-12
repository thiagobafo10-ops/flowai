import { createServerClient } from "@/lib/supabase/server";

export async function getUnreadCount(orgId: string): Promise<number> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("inbox_unread_count", { p_org: orgId });
  if (error) throw new Error("Falha ao carregar conversas não lidas", { cause: error });
  return Number(data ?? 0);
}
