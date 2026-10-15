import { expect, test } from "vitest";
import { vipSettingsSchema, vipPrivatePreview, vipErrorMessage, vipSaveInput, vipCardIdentity } from "./vip";
const valid = { channelId: "10000000-0000-4000-8000-000000000001", enabled: false, publicReplyText: "Convite VIP", groupUrl: "https://chat.whatsapp.com/FFHuLdtAehRCoIDP67bX5r" };
test("VIP drafts reject unsafe group links and blank or oversized UTF-8 replies", () => {
  expect(vipSettingsSchema.safeParse(valid).success).toBe(true);
  for (const groupUrl of ["http://chat.whatsapp.com/code", "https://chat.whatsapp.com.evil.test/code", "https://chat.whatsapp.com/", "https://user@chat.whatsapp.com/code", "https://chat.whatsapp.com/code?x=1"]) expect(vipSettingsSchema.safeParse({ ...valid, groupUrl }).success).toBe(false);
  for (const publicReplyText of ["  ", "á".repeat(501)]) expect(vipSettingsSchema.safeParse({ ...valid, publicReplyText }).success).toBe(false);
});
test("private preview uses the configured invite and failures never disclose raw errors", () => {
 expect(vipPrivatePreview("https://chat.whatsapp.com/changed")).toBe("Aqui está o convite para o nosso grupo VIP do WhatsApp: https://chat.whatsapp.com/changed");
 expect(vipErrorMessage("secret-token")).toBe("Não foi possível concluir a configuração VIP.");
 expect(vipErrorMessage("uncertain")).toContain("não será repetido");
});
test("persisted uncertain delivery codes explain that retries are blocked", () => {
 for (const code of ["network_error", "invalid_response", "operation_failed", "expired_send_lease"]) expect(vipErrorMessage(code)).toContain("não será repetido");
 expect(vipErrorMessage("provider_unavailable")).toContain("novamente");
});

test("pausing an active flow uses saved values even when the draft is invalid", () => {
 const paused = vipSaveInput("10000000-0000-4000-8000-000000000001", false, { publicReplyText: "", groupUrl: "https://invalid.test" }, { publicReplyText: "Saved reply", groupUrl: "https://chat.whatsapp.com/saved" }, true);
 expect(paused).toEqual({ channelId: "10000000-0000-4000-8000-000000000001", enabled: false, publicReplyText: "Saved reply", groupUrl: "https://chat.whatsapp.com/saved" });
 expect(vipSettingsSchema.safeParse(paused).success).toBe(true);
});

test("permission refresh preserves the VIP editor identity while pause or disconnect resets it", () => {
 const initial = { channelId: "ch", disconnected: false, vip: undefined };
 const checked = { ...initial, vip: { enabled: false, commentsVerifiedAt: "2026-10-14T12:00:00Z" } };
 expect(vipCardIdentity(initial)).toBe(vipCardIdentity(checked));
 expect(vipCardIdentity({ ...checked, vip: { ...checked.vip, enabled: true } })).not.toBe(vipCardIdentity(checked));
 expect(vipCardIdentity({ ...checked, disconnected: true })).not.toBe(vipCardIdentity(checked));
});
