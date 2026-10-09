"use server";

import { isIP } from "node:net";
import { redirect } from "next/navigation";
import { signInSchema, signUpSchema } from "@flowai/core";
import type { SignInInput, SignUpInput } from "@flowai/core";
import { createServerClient } from "@/lib/supabase/server";
import { getRequestIp } from "@/lib/request-ip";
import type { ActionResult } from "@/lib/action-result";

const MSG_DUPLICATE = "Este e-mail já está cadastrado.";
const MSG_INVALID_CREDENTIALS = "E-mail ou senha inválidos.";
const MSG_RATE_LIMIT =
  "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
const MSG_UNEXPECTED = "Não foi possível concluir. Tente novamente.";
const MSG_INVALID_FIELDS = "Verifique os campos informados.";

async function isAllowed(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    // Fail-open: falha na infraestrutura de rate limit não bloqueia o usuário.
    console.error("check_rate_limit failed", error);
    return true;
  }
  return data !== false;
}

export async function signUp(input: SignUpInput): Promise<ActionResult> {
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
  if (!(await isAllowed(supabase, `signup:${ip}`, 5, 3600))) {
    return { ok: false, error: MSG_RATE_LIMIT };
  }

  const { error } = await supabase.auth.signUp({
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
  if (!(await isAllowed(supabase, `login:${ip}:${email}`, 10, 900))) {
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

  const { error: auditError } = await supabase.rpc("write_audit_log", {
    p_org: null as unknown as string,
    p_action: "auth.login",
    p_entity_type: "user",
    p_entity_id: data.user.id,
    p_ip: isIP(ip) ? ip : undefined,
  });
  if (auditError) console.error("write_audit_log failed", auditError);

  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
