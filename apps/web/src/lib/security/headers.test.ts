import { describe, expect, it } from "vitest";
import { buildSecurityHeaders } from "./headers";

describe("buildSecurityHeaders", () => {
  it("gera headers básicos essenciais em desenvolvimento", () => {
    const headers = buildSecurityHeaders({ isProd: false, supabaseUrl: "http://127.0.0.1:54321" });
    const keys = headers.map((h) => h.key);

    expect(keys).toContain("Content-Security-Policy");
    expect(keys).toContain("X-Frame-Options");
    expect(keys).toContain("X-Content-Type-Options");
    expect(keys).toContain("Referrer-Policy");
    expect(keys).toContain("Permissions-Policy");

    const xFrame = headers.find((h) => h.key === "X-Frame-Options");
    expect(xFrame?.value).toBe("DENY");

    const nosniff = headers.find((h) => h.key === "X-Content-Type-Options");
    expect(nosniff?.value).toBe("nosniff");

    const permissions = headers.find((h) => h.key === "Permissions-Policy");
    expect(permissions?.value).toContain("camera=()");
    expect(permissions?.value).toContain("microphone=()");

    // Em dev não deve ativar HSTS
    expect(keys).not.toContain("Strict-Transport-Security");
  });

  it("ativa HSTS em produção", () => {
    const headers = buildSecurityHeaders({ isProd: true, supabaseUrl: "https://api.flowai.app" });
    const hsts = headers.find((h) => h.key === "Strict-Transport-Security");
    expect(hsts).toBeDefined();
    expect(hsts?.value).toContain("max-age=63072000");
    expect(hsts?.value).toContain("includeSubDomains");
  });

  it("configura CSP com restrições e conexão com o supabase", () => {
    const headers = buildSecurityHeaders({ isProd: true, supabaseUrl: "https://xyz.supabase.co" });
    const csp = headers.find((h) => h.key === "Content-Security-Policy");
    expect(csp?.value).toContain("default-src 'self'");
    expect(csp?.value).toContain("https://xyz.supabase.co");
    expect(csp?.value).toContain("frame-ancestors 'none'");
  });
});
