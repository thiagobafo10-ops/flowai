"use server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@flowai/core";

export type UnsubscribeResult = "Descadastro confirmado" | "Link inválido";
const TOKEN = /^[0-9a-f]{48}$/;

/** Descadastra pelo token do link. Token desconhecido e falha respondem igual: nunca revela se o contato existe. */
export async function unsubscribe(token: string): Promise<UnsubscribeResult> {
  if (!TOKEN.test(token)) return "Link inválido";
  try {
    const supabase = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await supabase.rpc("unsubscribe_email", { p_token: token });
    if (error) console.error("unsubscribe: rpc failed", error.code ?? "unknown");
    return data === true ? "Descadastro confirmado" : "Link inválido";
  } catch (error) {
    console.error("unsubscribe: rpc failed", error instanceof Error ? error.name : "unknown");
    return "Link inválido";
  }
}
