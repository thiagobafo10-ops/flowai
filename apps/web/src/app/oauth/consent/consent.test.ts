import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "user-1", email: "ana@example.test" } as { id: string; email?: string } | null,
  details: null as unknown,
  detailsError: null as unknown,
  decisionError: null as unknown,
  calls: [] as unknown[][],
  cookiesDeleted: [] as string[],
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ delete: (name: string) => { state.cookiesDeleted.push(name); } }) }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
      signOut: async () => { state.calls.push(["signOut"]); return { error: null }; },
      oauth: {
        getAuthorizationDetails: async (...args: unknown[]) => {
          state.calls.push(["getAuthorizationDetails", ...args]);
          return { data: state.details, error: state.detailsError };
        },
        approveAuthorization: async (...args: unknown[]) => {
          state.calls.push(["approveAuthorization", ...args]);
          return state.decisionError
            ? { data: null, error: state.decisionError }
            : { data: { redirect_url: "https://claude.ai/api/mcp/auth_callback?code=abc&state=s" }, error: null };
        },
        denyAuthorization: async (...args: unknown[]) => {
          state.calls.push(["denyAuthorization", ...args]);
          return state.decisionError
            ? { data: null, error: state.decisionError }
            : { data: { redirect_url: "https://claude.ai/api/mcp/auth_callback?error=access_denied&state=s" }, error: null };
        },
      },
    },
  }),
}));

import { loadConsent } from "./load-consent";
import { approveConsent, denyConsent, switchAccount } from "./actions";
import { ConsentCard, type ConsentCardProps } from "./consent-card";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const LOGIN = `/login?next=${encodeURIComponent("/oauth/consent?authorization_id=auth-1")}`;

function form(id?: string) {
  const data = new FormData();
  if (id !== undefined) data.set("authorization_id", id);
  return data;
}

beforeEach(() => {
  state.user = { id: "user-1", email: "ana@example.test" };
  state.cookiesDeleted = [];
  state.details = {
    authorization_id: "auth-1",
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    client: { id: "client-1", name: "Claude", uri: "", logo_uri: "" },
    user: { id: "user-1", email: "a@b.test" },
    scope: "",
  };
  state.detailsError = null;
  state.decisionError = null;
  state.calls = [];
});

describe("loadConsent", () => {
  it("consent without login redirects to login with return", async () => {
    state.user = null;
    expect(await loadConsent("auth-1")).toEqual({ kind: "login", to: LOGIN });
    expect(state.calls).toEqual([]);
  });

  it("returns invalid without an authorization id", async () => {
    expect(await loadConsent(undefined)).toEqual({ kind: "invalid" });
    expect(await loadConsent("")).toEqual({ kind: "invalid" });
  });

  it("shows the client name when consent is needed", async () => {
    expect(await loadConsent("auth-1")).toEqual({
      kind: "consent", authorizationId: "auth-1", clientName: "Claude", userEmail: "ana@example.test",
      redirectHost: "claude.ai", trustedRedirect: true,
    });
    expect(state.calls).toEqual([["getAuthorizationDetails", "auth-1"]]);
  });

  it("redirects immediately when the user already consented", async () => {
    state.details = { redirect_url: "https://claude.ai/cb?code=x" };
    expect(await loadConsent("auth-1")).toEqual({ kind: "redirect", url: "https://claude.ai/cb?code=x" });
  });

  it("returns error when the authorization cannot be loaded", async () => {
    state.details = null;
    state.detailsError = { message: "not found" };
    expect(await loadConsent("auth-1")).toEqual({ kind: "error" });
  });
});

describe("consent actions", () => {
  it("approve calls approveAuthorization and redirects to the client", async () => {
    await expect(approveConsent(form("auth-1"))).rejects.toThrow(
      "NEXT_REDIRECT:https://claude.ai/api/mcp/auth_callback?code=abc&state=s",
    );
    expect(state.calls).toEqual([["approveAuthorization", "auth-1", { skipBrowserRedirect: true }]]);
  });

  it("deny calls denyAuthorization and redirects to the client", async () => {
    await expect(denyConsent(form("auth-1"))).rejects.toThrow(
      "NEXT_REDIRECT:https://claude.ai/api/mcp/auth_callback?error=access_denied&state=s",
    );
    expect(state.calls).toEqual([["denyAuthorization", "auth-1", { skipBrowserRedirect: true }]]);
  });

  it("actions without login redirect to login with return and do not decide", async () => {
    state.user = null;
    await expect(approveConsent(form("auth-1"))).rejects.toThrow(`NEXT_REDIRECT:${LOGIN}`);
    await expect(denyConsent(form("auth-1"))).rejects.toThrow(`NEXT_REDIRECT:${LOGIN}`);
    expect(state.calls).toEqual([]);
  });

  it("decision failure returns to the consent page with an error flag", async () => {
    state.decisionError = { message: "expired" };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(approveConsent(form("auth-1"))).rejects.toThrow(
      "NEXT_REDIRECT:/oauth/consent?authorization_id=auth-1&erro=1",
    );
    errorSpy.mockRestore();
  });

  it("missing authorization id does not call Supabase", async () => {
    await expect(approveConsent(form())).rejects.toThrow("NEXT_REDIRECT:/oauth/consent");
    expect(state.calls).toEqual([]);
  });
});

describe("authorization id validation", () => {
  it.each(["../x", "a/b", "../..", "a b", "x".repeat(129), "a%2Fb"])("rejects %j without calling Supabase", async (id) => {
    expect(await loadConsent(id)).toEqual({ kind: "error" });
    await expect(approveConsent(form(id))).rejects.toThrow("NEXT_REDIRECT:/oauth/consent");
    await expect(denyConsent(form(id))).rejects.toThrow("NEXT_REDIRECT:/oauth/consent");
    await expect(switchAccount(form(id))).rejects.toThrow("NEXT_REDIRECT:/oauth/consent");
    expect(state.calls).toEqual([]);
  });

  it("rejects an already-consented response without a string redirect_url", async () => {
    state.details = { redirect_url: 42 };
    expect(await loadConsent("auth-1")).toEqual({ kind: "error" });
  });
});

describe("anti-phishing details", () => {
  it.each([
    ["https://claude.ai/api/mcp/auth_callback", "claude.ai", true],
    ["https://claude.com/cb", "claude.com", true],
    ["https://app.claude.ai/cb", "app.claude.ai", true],
    ["https://evil.example/cb", "evil.example", false],
    ["https://claude.ai.evil.example/cb", "claude.ai.evil.example", false],
    ["https://notclaude.ai/cb", "notclaude.ai", false],
    ["http://claude.ai/cb", "claude.ai", false],
    ["https://claude.ai:8443/cb", "claude.ai:8443", false],
    ["not a url", null, false],
  ])("redirect_uri %s → host %s, trusted %s", async (uri, host, trusted) => {
    (state.details as { redirect_uri: string }).redirect_uri = uri;
    expect(await loadConsent("auth-1")).toMatchObject({ redirectHost: host, trustedRedirect: trusted });
  });

  it("switchAccount signs out and returns to login with the same next", async () => {
    await expect(switchAccount(form("auth-1"))).rejects.toThrow(`NEXT_REDIRECT:${LOGIN}`);
    expect(state.calls).toEqual([["signOut"]]);
    expect(state.cookiesDeleted).toEqual(["flowai_org"]);
  });
});

describe("ConsentCard", () => {
  const noop = async () => {};
  function render(overrides: Partial<ConsentCardProps> = {}) {
    return renderToStaticMarkup(createElement(ConsentCard, {
      authorizationId: "auth-1", clientName: "Claude", userEmail: "ana@example.test",
      redirectHost: "claude.ai", trustedRedirect: true, failed: false,
      actions: { approve: noop, deny: noop, switchAccount: noop },
      ...overrides,
    }));
  }

  it("shows the question, the account, the switch action and the redirect host", () => {
    const html = render();
    expect(html).toContain("Permitir que o Claude gerencie suas automações do Instagram?");
    expect(html).toContain("Conta: <strong");
    expect(html).toContain("ana@example.test");
    expect(html).toContain("Não é você? Sair");
    expect(html).toContain("Você será redirecionado para:");
    expect(html).toContain(">claude.ai</strong>");
    expect(html).toContain("Permitir");
    expect(html).toContain("Recusar");
    expect(html).not.toContain("Atenção: este pedido não vem do Claude.");
  });

  it("warns when the redirect host is not Claude", () => {
    const html = render({ redirectHost: "evil.example", trustedRedirect: false });
    expect(html).toContain(">evil.example</strong>");
    expect(html).toContain("Atenção: este pedido não vem do Claude. Só permita se você reconhece este endereço.");
  });
});
