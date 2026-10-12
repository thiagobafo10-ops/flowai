"use server";

import { isIP } from "node:net";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signInSchema, signUpSchema } from "@flowai/core";
import type { SignInInput, SignUpInput } from "@flowai/core";
import { createServerClient } from "@/lib/supabase/server";
import { getRequestIp } from "@/lib/request-ip";
import { ACTIVE_ORG_COOKIE } from "@/lib/org/active-org";
import type { ActionResult } from "@/lib/action-result";

const MSG_DUPLICATE = "Este e-mail já está cadastrado.";
const MSG_INVALID_CREDENTIALS = "E-mail ou senha inválidos.";
const MSG_RATE_LIMIT =
  "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
const MSG_UNEXPECTED = "Não foi possível concluir. Tente novamente.";
const MSG_INVALID_FIELDS = "Verifique os campos informados.";

async function isAllowed(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  kind: "signup" | "login",
  subject: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  // check_rate_limit é só de servidor; o wrapper público fixa o namespace da chave.
  const { data, error } = await supabase.rpc("check_auth_rate_limit", {
    p_kind: kind,
    p_subject: subject,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    // Fail-open: falha na infraestrutura de rate limit não bloqueia o usuário.
    console.error("check_auth_rate_limit failed", error);
    return true;
  }
  return data !== false;
}

export type SignUpResult = { needsEmailConfirmation: true };

export async function signUp(
  input: SignUpInput,
): Promise<ActionResult<SignUpResult>> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: MSG_INVALID_FIELDS,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const { fullName, email, password } = parsed.data;

  const supabase = await createServerClient();
  const ip = await getRequestIp();
  if (!(await isAllowed(supabase, "signup", ip, 5, 3600))) {
    return { ok: false, error: MSG_RATE_LIMIT };
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) {
    if (error.code === "user_already_exists" || error.code === "email_exists") {
      return { ok: false, error: MSG_DUPLICATE };
    }
    console.error("signUp failed", error);
    return { ok: false, error: MSG_UNEXPECTED };
  }

  // Com confirmação de e-mail ligada, o Supabase não devolve sessão: o usuário
  // precisa confirmar antes de entrar (sem redirect para rota protegida).
  if (!data.session) {
    return { ok: true, data: { needsEmailConfirmation: true } };
  }

  redirect("/onboarding");
}

export async function signIn(input: SignInInput): Promise<ActionResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: MSG_INVALID_FIELDS,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const { email, password } = parsed.data;

  const supabase = await createServerClient();
  const ip = await getRequestIp();
  if (!(await isAllowed(supabase, "login", `${ip}:${email}`, 10, 900))) {
    return { ok: false, error: MSG_RATE_LIMIT };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user) {
    if (error?.code === "invalid_credentials") {
      return { ok: false, error: MSG_INVALID_CREDENTIALS };
    }
    console.error("signIn failed", error);
    return { ok: false, error: MSG_UNEXPECTED };
  }

  // Fail-open: falha ao auditar não impede o login.
  const { error: auditError } = await supabase.rpc("log_auth_event", {
    p_action: "auth.login",
    p_ip: isIP(ip) ? ip : undefined,
  });
  if (auditError) console.error("log_auth_event failed", auditError);

  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_ORG_COOKIE);
  redirect("/login");
}
