import { createClient } from "@supabase/supabase-js";
import type { Database } from "@flowai/core";

const CODE = /^[a-z0-9]{12}$/;

const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

const INVALID_HTML = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Link inválido · FlowAI</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0a0a0a; color: #fafafa;
        font-family: ui-sans-serif, system-ui, sans-serif; }
      main { max-width: 28rem; padding: 2rem; text-align: center; }
      h1 { margin: 0 0 .5rem; font-size: 1.5rem; }
      p { margin: 0; color: #a3a3a3; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <h1>Link inválido</h1>
      <p>Este link não existe ou expirou. Peça um novo link para quem enviou a mensagem.</p>
    </main>
  </body>
</html>`;

function invalidLink(): Response {
  return new Response(INVALID_HTML, {
    status: 404,
    headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * Link rastreável `/r/<código>`: registra o clique e redireciona para a URL guardada no banco.
 * Código malformado, desconhecido ou URL que não seja https vira a página "Link inválido" (nunca
 * redirecionamos para um valor arbitrário vindo da requisição).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await params;
  if (!CODE.test(code)) return invalidLink();

  let data: unknown;
  try {
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
    const result = await supabase.rpc("open_tracked_link", { p_code: code });
    if (result.error) {
      console.error("tracked link: open failed", result.error.code ?? "unknown");
      return invalidLink();
    }
    data = result.data;
  } catch (error) {
    console.error("tracked link: open failed", error instanceof Error ? error.name : "unknown");
    return invalidLink();
  }
  if (typeof data !== "string" || !data.startsWith("https://")) return invalidLink();

  return new Response(null, { status: 302, headers: { ...HEADERS, Location: data } });
}
