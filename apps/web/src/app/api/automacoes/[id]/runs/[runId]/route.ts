import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServerClient } from "@/lib/supabase/server";
import { loadEditorRefs } from "@/lib/automation/queries";
import { loadRunSteps } from "@/lib/automation/runs";
import { AUTOMATION_RUN_GONE, AUTOMATION_RUN_STEPS_LOAD_FAILED } from "@/lib/automation/messages";

const headers = { "Cache-Control": "no-store" };
const idSchema = z.uuid();

/** Passos de uma execução (carregados ao expandir a execução na aba "Execuções"). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  try {
    const org = await getActiveOrg();
    if (!org) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    const { id, runId } = await params;
    if (!idSchema.safeParse(id).success || !idSchema.safeParse(runId).success) {
      return NextResponse.json({ error: AUTOMATION_RUN_GONE }, { status: 404, headers });
    }
    const supabase = await createServerClient();
    const refs = await loadEditorRefs(supabase, org.id);
    const result = await loadRunSteps(supabase, org.id, id, runId, refs);
    if (!result) return NextResponse.json({ error: AUTOMATION_RUN_GONE }, { status: 404, headers });
    return NextResponse.json(result, { headers });
  } catch (error) {
    unstable_rethrow(error);
    console.error("automation run steps api failed", (error as { code?: string } | null)?.code);
    return NextResponse.json({ error: AUTOMATION_RUN_STEPS_LOAD_FAILED }, { status: 500, headers });
  }
}
