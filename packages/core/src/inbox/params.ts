import { z } from "zod";

export type InboxTab = "minhas" | "nao-atribuidas" | "aguardando" | "todas" | "fechadas";

export const INBOX_TABS: {
  value: InboxTab;
  label: "Minhas" | "Não atribuídas" | "Aguardando humano" | "Todas" | "Fechadas";
}[] = [
  { value: "minhas", label: "Minhas" },
  { value: "nao-atribuidas", label: "Não atribuídas" },
  { value: "aguardando", label: "Aguardando humano" },
  { value: "todas", label: "Todas" },
  { value: "fechadas", label: "Fechadas" },
];

export type InboxParams = {
  tab: InboxTab;
  conversationId: string | null;
  q: string;
  channelId: string | null;
};

const uuid = z.uuid();

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseInboxParams(sp: Record<string, string | string[] | undefined>): InboxParams {
  const aba = first(sp.aba);
  const tab = INBOX_TABS.find((t) => t.value === aba)?.value ?? "todas";
  const c = first(sp.c);
  const canal = first(sp.canal);
  return {
    tab,
    conversationId: c !== undefined && uuid.safeParse(c).success ? c : null,
    q: (first(sp.q) ?? "").trim().slice(0, 100),
    channelId: canal !== undefined && uuid.safeParse(canal).success ? canal : null,
  };
}
