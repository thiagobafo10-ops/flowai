import type { Database } from "../db/database.types.ts";

export type ContactStatus = Database["public"]["Enums"]["contact_status"];
export type ContactSource = Database["public"]["Enums"]["contact_source"];

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  lead: "Lead",
  customer: "Cliente",
  inactive: "Inativo",
};

export const CONTACT_SOURCE_LABELS: Record<ContactSource | "simulator", string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  manual: "Manual",
  simulator: "Simulador",
};
