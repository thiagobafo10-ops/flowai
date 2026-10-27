import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  details: null as unknown,
  detailsError: null as unknown,
  decisionError: null as unknown,
  calls: [] as unknown[][],
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
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
import { approveConsent, denyConsent } from "./actions";

const LOGIN = `/login?next=${encodeURIComponent("/oauth/consent?authorization_id=auth-1")}`;

function form(id?: string) {
  const data = new FormData();
  if (id !== undefined) data.set("authorization_id", id);
  return data;
}

beforeEach(() => {
  state.user = { id: "user-1" };
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
    expect(await loadConsent("auth-1")).toEqual({ kind: "consent", authorizationId: "auth-1", clientName: "Claude" });
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
