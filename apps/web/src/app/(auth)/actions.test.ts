import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: [] as unknown[][], allowed: true, redirects: [] as string[] }));
vi.mock("next/headers", () => ({ cookies: async () => ({ delete: () => {} }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { state.redirects.push(url); throw new Error("NEXT_REDIRECT"); } }));
vi.mock("@/lib/request-ip", () => ({ getRequestIp: async () => "203.0.113.7" }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    rpc: async (...args: unknown[]) => { state.rpc.push(args); return { data: args[0] === "log_auth_event" ? null : state.allowed, error: null }; },
    auth: {
      signUp: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async () => ({ data: { user: { id: "u" } }, error: null }),
    },
  }),
}));
import { signIn, signUp } from "./actions";

beforeEach(() => { state.rpc = []; state.allowed = true; });

test("cadastro usa o limite público com namespace signup", async () => {
  await signUp({ fullName: "Ana Souza", email: "ana@example.test", password: "senha-segura-123" });
  expect(state.rpc[0]).toEqual(["check_auth_rate_limit", { p_kind: "signup", p_subject: "203.0.113.7", p_limit: 5, p_window_seconds: 3600 }]);
  expect(state.rpc.some(([name]) => name === "check_rate_limit")).toBe(false);
});

test("login usa o limite público com namespace login por IP e e-mail", async () => {
  await expect(signIn({ email: "ana@example.test", password: "senha-segura-123" })).rejects.toThrow("NEXT_REDIRECT");
  expect(state.rpc[0]).toEqual(["check_auth_rate_limit", { p_kind: "login", p_subject: "203.0.113.7:ana@example.test", p_limit: 10, p_window_seconds: 900 }]);
});

test("limite excedido bloqueia o cadastro", async () => {
  state.allowed = false;
  expect(await signUp({ fullName: "Ana Souza", email: "ana@example.test", password: "senha-segura-123" })).toEqual({ ok: false, error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." });
});

test("login volta ao consentimento OAuth quando há retorno seguro", async () => {
  state.redirects = [];
  await expect(signIn({ email: "ana@example.test", password: "senha-segura-123" }, "/oauth/consent?authorization_id=a1")).rejects.toThrow("NEXT_REDIRECT");
  expect(state.redirects).toEqual(["/oauth/consent?authorization_id=a1"]);
});

test("login ignora retorno para outro domínio", async () => {
  state.redirects = [];
  await expect(signIn({ email: "ana@example.test", password: "senha-segura-123" }, "//evil.example")).rejects.toThrow("NEXT_REDIRECT");
  expect(state.redirects).toEqual(["/dashboard"]);
});
