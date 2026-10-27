import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ user: null as { id: string } | null, clients: 0 }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => {
    state.clients += 1;
    return { auth: { getUser: async () => ({ data: { user: state.user } }) } };
  },
}));

import { updateSession } from "./session";

beforeEach(() => {
  state.user = null;
  state.clients = 0;
});

describe("updateSession (proxy)", () => {
  it.each(["/mcp", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"])(
    "lets bearer route %s through without session or redirect",
    async (path) => {
      const response = await updateSession(new NextRequest(`http://localhost:3000${path}`));
      expect(response.headers.get("location")).toBeNull();
      expect(state.clients).toBe(0);
    },
  );

  it("redirects oauth consent without login to login with return", async () => {
    const response = await updateSession(
      new NextRequest("http://localhost:3000/oauth/consent?authorization_id=auth-1"),
    );
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/oauth/consent?authorization_id=auth-1");
  });

  it("keeps the plain login redirect for other protected routes", async () => {
    const response = await updateSession(new NextRequest("http://localhost:3000/dashboard?x=1"));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.search).toBe("");
  });

  it("serves oauth consent to a logged-in user", async () => {
    state.user = { id: "u" };
    const response = await updateSession(
      new NextRequest("http://localhost:3000/oauth/consent?authorization_id=auth-1"),
    );
    expect(response.headers.get("location")).toBeNull();
  });
});
