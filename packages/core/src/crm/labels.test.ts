import { expect, it } from "vitest";
import { CONTACT_SOURCE_LABELS, CONTACT_STATUS_LABELS } from "./labels.ts";

it("has pt-BR labels", () => {
  expect(CONTACT_STATUS_LABELS).toEqual({ lead: "Lead", customer: "Cliente", inactive: "Inativo" });
  expect(CONTACT_SOURCE_LABELS).toEqual({ whatsapp: "WhatsApp", instagram: "Instagram", manual: "Manual" });
});
