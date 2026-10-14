export type SecurityHeaderOption = {
  isProd: boolean;
  supabaseUrl: string;
};

export type HeaderEntry = {
  key: string;
  value: string;
};

/**
 * Constrói a lista de cabeçalhos HTTP de segurança para o Next.js.
 */
export function buildSecurityHeaders({ isProd, supabaseUrl }: SecurityHeaderOption): HeaderEntry[] {
  const normalizedUrl = supabaseUrl.replace(/\/+$/, "");
  const supabaseWs = normalizedUrl.replace(/^http/, "ws");

  const cspDirectives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${normalizedUrl} ${supabaseWs}${isProd ? "" : " ws://localhost:* ws://127.0.0.1:*"}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  const headers: HeaderEntry[] = [
    { key: "Content-Security-Policy", value: cspDirectives.join("; ") },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-DNS-Prefetch-Control", value: "on" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    },
  ];

  if (isProd) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }

  return headers;
}
