import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  clientOptions: undefined as unknown,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, _key: string, options: unknown) => {
    state.clientOptions = options;
    return { rpc: state.rpc };
  },
}));

import { GET } from "./route";

function call(code: string) {
  return GET(new Request(`http://localhost/r/${code}`), { params: Promise.resolve({ code }) });
}

describe("GET /r/[code]", () => {
  beforeEach(() => {
    state.rpc.mockReset();
    state.clientOptions = undefined;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("redirects a known code to the stored https URL without caching or referrer", async () => {
    state.rpc.mockResolvedValue({ data: "https://loja.example.com/promo?utm=ig", error: null });

    const response = await call("abcdefghijkl");

    expect(state.rpc).toHaveBeenCalledWith("open_tracked_link", { p_code: "abcdefghijkl" });
    expect(state.clientOptions).toMatchObject({ auth: { persistSession: false, autoRefreshToken: false } });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://loja.example.com/promo?utm=ig");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it.each([
    ["path traversal", "../x"],
    ["long code", "a".repeat(200)],
    ["uppercase", "ABCDEFGHIJKL"],
    ["unknown but well formed", "zzzzzzzzzzzz"],
  ])("answers 404 for %s", async (_label, code) => {
    state.rpc.mockResolvedValue({ data: null, error: null });

    const response = await call(code);

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toContain("Link inválido");
    if (!/^[a-z0-9]{12}$/.test(code)) expect(state.rpc).not.toHaveBeenCalled();
  });

  it.each(["javascript:alert(1)", "http://evil.example", "//evil.example", "/r/outra"])(
    "never redirects to a value that is not https: %s",
    async (url) => {
      state.rpc.mockResolvedValue({ data: url, error: null });

      const response = await call("abcdefghijkl");

      expect(response.status).toBe(404);
      expect(response.headers.get("Location")).toBeNull();
    },
  );

  it("answers 404 without leaking details when the RPC fails", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "forbidden" } });

    const response = await call("abcdefghijkl");
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).toContain("Link inválido");
    expect(body).not.toContain("forbidden");
    expect(body).not.toContain("42501");
  });
});
