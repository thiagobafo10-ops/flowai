import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getRoot } from "@/app/.well-known/oauth-protected-resource/route";
import { GET as getMcp } from "@/app/.well-known/oauth-protected-resource/mcp/route";
import { protectedResourceMetadata, requestOrigin, resourceMetadataUrl } from "./resource-metadata";

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co"));
afterEach(() => vi.unstubAllEnvs());

describe("requestOrigin", () => {
  it("uses the request URL origin", () => {
    expect(requestOrigin(new Request("http://localhost:3000/mcp?x=1"))).toBe("http://localhost:3000");
  });

  it("respects x-forwarded-host and x-forwarded-proto (Vercel)", () => {
    const request = new Request("http://internal:3000/mcp", {
      headers: { "x-forwarded-host": "app.example.com, other", "x-forwarded-proto": "https,http" },
    });
    expect(requestOrigin(request)).toBe("https://app.example.com");
  });

  it("ignores malformed forwarded values", () => {
    const request = new Request("http://localhost:3000/mcp", {
      headers: { "x-forwarded-host": "evil.com/path@x", "x-forwarded-proto": "javascript" },
    });
    expect(requestOrigin(request)).toBe("http://localhost:3000");
  });
});

describe("protected resource metadata", () => {
  it("points to the Supabase authorization server", () => {
    expect(protectedResourceMetadata("https://app.example.com")).toEqual({
      resource: "https://app.example.com/mcp",
      authorization_servers: ["https://ref.supabase.co/auth/v1"],
      bearer_methods_supported: ["header"],
    });
    expect(resourceMetadataUrl("https://app.example.com")).toBe(
      "https://app.example.com/.well-known/oauth-protected-resource/mcp",
    );
  });

  it("strips a trailing slash from the Supabase URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co/");
    expect(protectedResourceMetadata("https://a.test").authorization_servers).toEqual(["https://ref.supabase.co/auth/v1"]);
  });

  it.each([
    ["root", getRoot],
    ["mcp", getMcp],
  ])("GET /.well-known/oauth-protected-resource (%s) serves the metadata", async (_name, handler) => {
    const response = await handler(
      new Request("http://internal/.well-known/oauth-protected-resource", {
        headers: { "x-forwarded-host": "flowai.example.com", "x-forwarded-proto": "https" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      resource: "https://flowai.example.com/mcp",
      authorization_servers: ["https://ref.supabase.co/auth/v1"],
      bearer_methods_supported: ["header"],
    });
  });
});
