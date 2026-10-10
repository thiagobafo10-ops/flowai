import type { ChannelType } from "@flowai/core";
import { createServerClient } from "@/lib/supabase/server";

export type ChannelRow = {
  id: string;
  type: ChannelType;
  name: string;
  status: "needs_setup" | "active" | "error";
};

/** Colunas explícitas: segredos e tokens do canal nunca saem do banco. */
export async function listChannels(orgId: string): Promise<ChannelRow[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("channels")
    .select("id, type, name, status")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data as ChannelRow[];
}
