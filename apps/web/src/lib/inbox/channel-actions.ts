"use server";

import { z } from "zod";
import { SimulatorProvider, simulatorInboundSchema } from "@flowai/core";
import type { ActionResult } from "@/lib/action-result";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServerClient } from "@/lib/supabase/server";

const MSG_FORBIDDEN = "Você não tem permissão para esta ação.";
const MSG_UNEXPECTED = "Não foi possível concluir. Tente novamente.";
const MSG_DUPLICATE = "Já existe um canal Simulador.";
const MSG_INACTIVE = "O canal Simulador está desativado.";
const ADMIN_ROLES = ["admin", "owner"];

async function adminOrg() {
  const org = await getActiveOrg();
  if (!org || !ADMIN_ROLES.includes(org.role)) return null;
  return org;
}

export async function createSimulatorChannel(): Promise<ActionResult<{ id: string }>> {
  const org = await adminOrg();
  if (!org) return { ok: false, error: MSG_FORBIDDEN };
  const supabase = await createServerClient();
  // O grant de insert não inclui status (default needs_setup): ativa em seguida.
  const { data, error } = await supabase
    .from("channels")
    .insert({ organization_id: org.id, type: "simulator", name: "Simulador" })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: MSG_DUPLICATE };
    if (error.code === "42501") return { ok: false, error: MSG_FORBIDDEN };
    console.error("create simulator channel failed", error);
    return { ok: false, error: MSG_UNEXPECTED };
  }
  const { data: updated, error: updateError } = await supabase
    .from("channels")
    .update({ status: "active" })
    .eq("organization_id", org.id)
    .eq("id", data.id)
    .select("id");
  if (updateError || updated.length === 0) {
    console.error("activate simulator channel failed", updateError);
    return { ok: false, error: MSG_UNEXPECTED };
  }
  return { ok: true, data: { id: data.id } };
}

export async function setSimulatorActive(channelId: string, active: boolean): Promise<ActionResult> {
  const org = await adminOrg();
  if (!org) return { ok: false, error: MSG_FORBIDDEN };
  if (!z.uuid().safeParse(channelId).success || typeof active !== "boolean") {
    return { ok: false, error: MSG_UNEXPECTED };
  }
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("channels")
    .update({ status: active ? "active" : "needs_setup" })
    .eq("organization_id", org.id)
    .eq("id", channelId)
    .eq("type", "simulator")
    .select("id");
  if (error) {
    if (error.code === "42501") return { ok: false, error: MSG_FORBIDDEN };
    console.error("set simulator active failed", error);
    return { ok: false, error: MSG_UNEXPECTED };
  }
  if (data.length === 0) return { ok: false, error: MSG_FORBIDDEN };
  return { ok: true, data: undefined };
}

export async function simulateInbound(input: {
  name: string | null;
  phone: string;
  text: string;
}): Promise<ActionResult<{ conversationId: string }>> {
  const org = await adminOrg();
  if (!org) return { ok: false, error: MSG_FORBIDDEN };

  const parsed = simulatorInboundSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "text");
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, error: parsed.error.issues[0]?.message ?? MSG_UNEXPECTED, fieldErrors };
  }

  const supabase = await createServerClient();
  const { data: channel, error: channelError } = await supabase
    .from("channels")
    .select("id, status")
    .eq("organization_id", org.id)
    .eq("type", "simulator")
    .maybeSingle();
  if (channelError) {
    console.error("simulate inbound: channel lookup failed", channelError);
    return { ok: false, error: MSG_UNEXPECTED };
  }
  if (!channel) return { ok: false, error: "Crie o canal Simulador antes de simular." };
  if (channel.status !== "active") return { ok: false, error: MSG_INACTIVE };

  const [message] = new SimulatorProvider().receiveMessage(parsed.data);
  const { data: messageId, error } = await supabase.rpc("ingest_inbound_message", {
    p_channel: channel.id,
    p_external_id: message.externalId,
    p_sender_external_id: message.senderExternalId,
    p_sender_name: message.senderName as string,
    p_text: message.text,
    p_sent_at: message.sentAt,
  });
  if (error) {
    if (error.code === "P0002") return { ok: false, error: MSG_INACTIVE };
    if (error.code === "42501") return { ok: false, error: MSG_FORBIDDEN };
    console.error("simulate inbound failed", error);
    return { ok: false, error: MSG_UNEXPECTED };
  }

  const { data: row, error: rowError } = await supabase
    .from("messages")
    .select("conversation_id")
    .eq("organization_id", org.id)
    .eq("id", messageId)
    .maybeSingle();
  if (rowError || !row) {
    console.error("simulate inbound: conversation lookup failed", rowError);
    return { ok: false, error: MSG_UNEXPECTED };
  }
  return { ok: true, data: { conversationId: row.conversation_id } };
}
