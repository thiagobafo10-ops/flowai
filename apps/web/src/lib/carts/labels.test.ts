import { describe, expect, it } from "vitest";
import { ACTION_LABELS, COMMERCIAL_LABELS, STAGE_LABELS } from "./labels";
import { cancelReasonLabel } from "@/lib/emails/schemas";

// Valores literais dos checks do banco (20261105000001_cart_recovery.sql).
describe("rótulos", () => {
  it("cobrem os estados comerciais", () => {
    expect(Object.keys(COMMERCIAL_LABELS).sort()).toEqual(
      ["abandoned", "cancelled", "order_created", "paid", "payment_pending"],
    );
    expect(COMMERCIAL_LABELS.payment_pending).toBe("Aguardando pagamento");
  });
  it("cobrem os estágios", () => {
    expect(Object.keys(STAGE_LABELS).sort()).toEqual(["closed", "contacted", "new", "waiting_reply"]);
    expect(STAGE_LABELS.contacted).toBe("Contato realizado");
  });
  it("cobrem as ações", () => {
    expect(Object.keys(ACTION_LABELS).sort()).toEqual(
      ["closed", "emails_stopped", "marked_sent", "note", "opened_whatsapp", "paused", "reopened", "reply_received", "resumed"],
    );
    expect(ACTION_LABELS.opened_whatsapp).toBe("WhatsApp aberto (não conta como envio)");
    expect(ACTION_LABELS.marked_sent).toBe("Envio confirmado pelo operador");
  });
  it("e-mail interrompido pelo operador tem rótulo", () => {
    expect(cancelReasonLabel("paused_by_operator")).toBe("Interrompido pelo operador");
  });
});
