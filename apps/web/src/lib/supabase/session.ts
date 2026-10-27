import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@flowai/core";

const PUBLIC_ROUTES = ["/login", "/signup"];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

// Conector MCP: autenticação por Bearer (OAuth), sem cookies nem redirect ao login.
function isBearerRoute(pathname: string): boolean {
  return pathname === "/mcp" || pathname.startsWith("/mcp/") || pathname.startsWith("/.well-known/");
}

function redirectTo(request: NextRequest, pathname: string, from: NextResponse, search = "") {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = search;
  const response = NextResponse.redirect(url);
  // Preserva cookies de sessão renovados no redirect.
  for (const cookie of from.cookies.getAll()) response.cookies.set(cookie);
  return response;
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  if (isBearerRoute(request.nextUrl.pathname)) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() valida o token no servidor Auth (não confiar em getSession()).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  // APIs: sem redirect; cada Route Handler valida a sessão e responde 401.
  if (pathname.startsWith("/api/")) return response;
  if (!user && pathname === "/oauth/consent") {
    // Consentimento OAuth: volta ao mesmo pedido de autorização depois do login.
    const next = `${pathname}${request.nextUrl.search}`;
    return redirectTo(request, "/login", response, `?next=${encodeURIComponent(next)}`);
  }
  if (!user && !isPublicRoute(pathname)) return redirectTo(request, "/login", response);
  if (user && isPublicRoute(pathname)) return redirectTo(request, "/dashboard", response);
  return response;
}
