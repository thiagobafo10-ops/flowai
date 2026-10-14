import { beforeEach, expect, test, vi } from "vitest";
import { validateOutreachMessage } from "@flowai/core";
import { delayToMinutes, minutesToDelay } from "./delay";

const state = vi.hoisted(() => ({
  role: "admin",
  authenticated: true,
  error: null as null | { code: string; message?: string },
  calls: [] as unknown[][],
}));

vi.mock("@/lib/org/active-org", () => ({
  getActiveOrg: async () => ({ id: "org", role: state.role }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: "u" } : null } }) },
    rpc: async (...args: unknown[]) => {
      state.calls.push(args);
      return { data: "seq-id", error: state.error };
    },
  }),
}));

import {
  deleteSequence,
  enrollContactInSequence,
  removeContactFromSequence,
  saveSequence,
  setSequenceStatus,
} from "./actions";

const ID1 = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  state.role = "admin";
  state.authenticated = true;
  state.error = null;
  state.calls = [];
});

test("conversão de unidades de espera ida e volta", () => {
  expect(delayToMinutes(5, "minutes")).toBe(5);
  expect(delayToMinutes(2, "hours")).toBe(120);
  expect(delayToMinutes(3, "days")).toBe(4320);

  expect(minutesToDelay(5)).toEqual({ value: 5, unit: "minutes" });
  expect(minutesToDelay(120)).toEqual({ value: 2, unit: "hours" });
  expect(minutesToDelay(4320)).toEqual({ value: 3, unit: "days" });
  expect(minutesToDelay(90)).toEqual({ value: 90, unit: "minutes" });
});

test("validação de limite de 640 caracteres para botões no Instagram", () => {
  const longText = "a".repeat(641);
  const issues = validateOutreachMessage(
    {
      text: longText,
      buttons: [{ id: "b1", title: "Site", kind: "url", url: "https://flowai.com" }],
    },
    "instagram",
  );
  expect(issues.some((i) => i.code === "button_text_too_long_instagram")).toBe(true);

  const shortText = "a".repeat(640);
  const okIssues = validateOutreachMessage(
    {
      text: shortText,
      buttons: [{ id: "b1", title: "Site", kind: "url", url: "https://flowai.com" }],
    },
    "instagram",
  );
  expect(okIssues.some((i) => i.code === "button_text_too_long_instagram")).toBe(false);
});

test("saveSequence envia payload validado para RPC e trata erro no_steps", async () => {
  const validSeq = {
    name: "Onboarding Leads",
    settings: { channelIds: [ID1], exitOnReply: true, exitWords: ["sair"] },
    steps: [
      {
        delayMinutes: 60,
        window: null,
        message: { text: "Olá! Seja bem-vindo." },
      },
    ],
  };

  const res = await saveSequence(validSeq);
  expect(res).toEqual({ ok: true, data: { id: "seq-id" } });
  expect(state.calls).toHaveLength(1);
  expect(state.calls[0][0]).toBe("save_sequence");

  state.error = { code: "22023", message: "no_steps" };
  const fail = await saveSequence(validSeq);
  expect(fail).toEqual({ ok: false, error: "Adicione ao menos um passo antes de ativar." });
});

test("permissões: viewer não altera sequências; agent pode inscrever e remover da ficha", async () => {
  state.role = "viewer";
  expect((await saveSequence({ name: "Teste", settings: {}, steps: [] })).ok).toBe(false);
  expect((await setSequenceStatus({ id: ID1, status: "active" })).ok).toBe(false);
  expect((await deleteSequence(ID1)).ok).toBe(false);
  expect((await enrollContactInSequence({ sequenceId: ID1, contactId: ID2 })).ok).toBe(false);
  expect((await removeContactFromSequence({ sequenceId: ID1, contactId: ID2 })).ok).toBe(false);
  expect(state.calls).toHaveLength(0);

  state.role = "agent";
  expect((await saveSequence({ name: "Teste", settings: {}, steps: [] })).ok).toBe(false);
  expect((await enrollContactInSequence({ sequenceId: ID1, contactId: ID2 })).ok).toBe(true);
  expect((await removeContactFromSequence({ sequenceId: ID1, contactId: ID2 })).ok).toBe(true);
  expect(state.calls).toHaveLength(2);
});
