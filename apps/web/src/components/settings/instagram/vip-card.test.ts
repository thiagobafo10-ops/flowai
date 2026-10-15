import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
vi.mock("@/lib/instagram/actions", () => ({ saveInstagramVipSettings: vi.fn(), verifyInstagramVipPermission: vi.fn() }));
import { InstagramVipCard } from "./vip-card";
test("an unconfigured channel previews both messages and requires verification before activation", () => {
 const html = renderToStaticMarkup(createElement(InstagramVipCard, { connection: { id: "c", channelId: "ch", name: "Instagram", status: "active", accountId: "1", appId: "2", apiVersion: "v26.0", tokenVerified: true, webhookVerified: true, disconnected: false, lastError: null, callbackUrl: "https://test" }, onChanged: () => {} }));
 expect(html).toContain("Quer entrar no nosso grupo VIP do WhatsApp? Comente VIP para receber o link no Direct.");
 expect(html).toContain("Aqui está o convite para o nosso grupo VIP do WhatsApp: https://chat.whatsapp.com/FFHuLdtAehRCoIDP67bX5r");
 expect(html).toContain("Somente novos comentários após a ativação");
 expect(html).toMatch(/disabled=""[^>]*>Ativar VIP/);
 expect(html).toContain("Salvar desativado");
});
