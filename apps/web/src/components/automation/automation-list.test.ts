import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ automations: [] as unknown[] }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ isPending: false, isError: false, data: { automations: state.automations, canWrite: false } }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/automation/actions", () => ({
  activateAutomation: vi.fn(),
  createAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
  duplicateAutomation: vi.fn(),
  pauseAutomation: vi.fn(),
}));
vi.mock("./ai-dialog", () => ({ AutomationAiDialog: () => null }));

import { AutomationList } from "./automation-list";

beforeEach(() => {
  state.automations = [];
});

test("mostra disparos, cliques e contatos de 7 dias e o selo apenas nas automações do Claude", () => {
  state.automations = [
    {
      id: "auto-mcp", name: "Promo de outubro", triggerType: "keyword_detected", status: "active",
      runs7d: 12, clicks7d: 5, contacts7d: 7, createdByClaude: true, updatedAt: "2026-10-26T10:00:00Z",
    },
    {
      id: "auto-panel", name: "Boas-vindas", triggerType: "comment", status: "paused",
      runs7d: 3, clicks7d: 0, contacts7d: 2, createdByClaude: false, updatedAt: "2026-10-25T10:00:00Z",
    },
  ];

  const markup = renderToStaticMarkup(createElement(AutomationList, { orgId: "org" }));

  for (const heading of ["Execuções (7 dias)", "Cliques (7 dias)", "Contatos (7 dias)"]) {
    expect(markup).toContain(heading);
  }
  for (const value of [">12<", ">5<", ">7<", ">3<", ">0<", ">2<"]) expect(markup).toContain(value);
  expect(markup).toContain("Promo de outubro");
  expect(markup).toContain("Boas-vindas");
  expect(markup.split("Criada pelo Claude")).toHaveLength(2);
});
