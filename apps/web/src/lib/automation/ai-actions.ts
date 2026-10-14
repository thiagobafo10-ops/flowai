"use server";

import {
  buildAutomationPrompt,
  sanitizeAndValidateGeneratedGraph,
  type AutomationGraph,
  type SanitizedAiGraphResult,
} from "@flowai/core";
import type { ActionResult } from "@/lib/action-result";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServerClient } from "@/lib/supabase/server";
import { loadEditorRefs, loadGraphRefs } from "./queries";
import {
  AUTOMATION_AI_FAILED,
  AUTOMATION_AI_NOT_CONFIGURED,
  AUTOMATION_AI_PROMPT_REQUIRED,
  AUTOMATION_AI_PROMPT_TOO_LONG,
  AUTOMATION_FORBIDDEN,
} from "./messages";

export type GenerateAutomationInput = {
  prompt: string;
  currentGraph?: AutomationGraph;
};

export type GenerateAutomationOptions = {
  fetchFn?: typeof fetch;
};

/**
 * Server Action para gerar fluxos de automação através de Inteligência Artificial.
 * Apenas usuários com perfil "owner" ou "admin" na organização ativa podem solicitar a geração.
 */
export async function generateAutomationWithAi(
  input: GenerateAutomationInput,
  options?: GenerateAutomationOptions,
): Promise<ActionResult<SanitizedAiGraphResult>> {
  const org = await getActiveOrg();
  if (!org || !["owner", "admin"].includes(org.role)) {
    return { ok: false, error: AUTOMATION_FORBIDDEN };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: AUTOMATION_FORBIDDEN };
  }

  const trimmedPrompt = input.prompt?.trim() ?? "";
  if (trimmedPrompt.length < 3) {
    return { ok: false, error: AUTOMATION_AI_PROMPT_REQUIRED };
  }
  if (trimmedPrompt.length > 1000) {
    return { ok: false, error: AUTOMATION_AI_PROMPT_TOO_LONG };
  }

  const [{ refs }, editorRefs] = await Promise.all([
    loadGraphRefs(supabase, org.id),
    loadEditorRefs(supabase, org.id),
  ]);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, error: AUTOMATION_AI_NOT_CONFIGURED };
  }

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const systemPrompt = buildAutomationPrompt(trimmedPrompt, editorRefs, input.currentGraph);
  const fetchImpl = options?.fetchFn || fetch;

  try {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: trimmedPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      return { ok: false, error: AUTOMATION_AI_FAILED };
    }

    const payload = await response.json();
    const rawContent = payload?.choices?.[0]?.message?.content;
    if (!rawContent || typeof rawContent !== "string") {
      return { ok: false, error: AUTOMATION_AI_FAILED };
    }

    const sanitized = sanitizeAndValidateGeneratedGraph(rawContent, refs);
    return { ok: true, data: sanitized };
  } catch (err) {
    console.error("generateAutomationWithAi error:", err);
    return { ok: false, error: AUTOMATION_AI_FAILED };
  }
}
