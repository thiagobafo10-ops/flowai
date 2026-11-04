import { DEFAULT_WHATSAPP_TEMPLATE } from "@flowai/core";
import { createServerClient } from "@/lib/supabase/server";
import { toRpcFilters, type CartFilters } from "./schemas";

export type CartRow = {
  id: string; customerName: string | null; phoneValid: boolean; total: number | null; itemsCount: number;
  abandonedAt: string | null; receivedAt: string; commercialStatus: string; recoveryStage: string;
  paused: boolean; unreconciledPayment: boolean; blockReason: string | null; lastContactAt: string | null;
};
export type CartDetail = {
  id: string; externalId: string | null; total: number | null;
  items: { name?: string; quantity?: number; price?: number; sku?: string }[] | null;
  abandonedAt: string | null; receivedAt: string; convertedAt: string | null;
  commercialStatus: string; recoveryStage: string; pausedAt: string | null; pauseReason: string | null;
  closedAt: string | null; lastContactAt: string | null; recoveryUrlAllowed: boolean;
  unreconciledPayment: boolean; blockReason: string | null;
  contact: { id: string; name: string | null; email: string | null; phone: string | null; phoneValid: boolean; blockedAt: string | null; blockedReason: string | null };
  permission: { status: string; source: string; evidenceAt: string; recordedAt: string } | null;
  emails: { id: string; stepPosition: number; subject: string; state: string; cancelReason: string | null; sendAt: string;
    sentAt: string | null; deliveredAt: string | null; openedAt: string | null; clickedAt: string | null; bouncedAt: string | null }[];
  actions: { id: string; action: string; note: string | null; actorName: string | null; createdAt: string }[];
};

export async function listCarts(orgId: string, f: CartFilters): Promise<{ total: number; rows: CartRow[] }> {
  const db = await createServerClient();
  const { data, error } = await db.rpc("list_store_carts", {
    p_org: orgId, p_filters: toRpcFilters(f), p_page: f.page, p_page_size: f.pageSize,
  });
  if (error) throw new Error("Falha ao carregar carrinhos", { cause: error });
  return data as unknown as { total: number; rows: CartRow[] };
}

export async function getCart(orgId: string, id: string): Promise<CartDetail | null> {
  // O RPC dá 42501 para carrinho inexistente ou de outra organização; id malformado seria 22P02.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await createServerClient();
  const { data, error } = await db.rpc("get_store_cart", { p_org: orgId, p_cart: id });
  if (error?.code === "42501") return null;
  if (error) throw new Error("Falha ao carregar carrinho", { cause: error });
  return data as unknown as CartDetail;
}

export async function getRecoverySettings(orgId: string): Promise<{ template: string; hosts: string[]; hasStore: boolean; checkoutConsent: boolean }> {
  const db = await createServerClient();
  const [s, c] = await Promise.all([
    db.from("cart_recovery_settings").select("whatsapp_template, checkout_whatsapp_consent").eq("organization_id", orgId).maybeSingle(),
    db.from("store_connections").select("checkout_hosts").eq("organization_id", orgId).maybeSingle(),
  ]);
  if (s.error || c.error) throw new Error("Falha ao carregar configurações de carrinhos", { cause: s.error ?? c.error });
  return { template: s.data?.whatsapp_template ?? DEFAULT_WHATSAPP_TEMPLATE, hosts: c.data?.checkout_hosts ?? [], hasStore: !!c.data, checkoutConsent: s.data?.checkout_whatsapp_consent ?? false };
}
