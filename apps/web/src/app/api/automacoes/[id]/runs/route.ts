import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServerClient } from "@/lib/supabase/server";
import { listAutomationRuns } from "@/lib/automation/runs";
import { AUTOMATION_GONE, AUTOMATION_RUNS_LOAD_FAILED } from "@/lib/automation/messages";

const headers = { "Cache-Control": "no-store" };
const idSchema = z.uuid();

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getActiveOrg();
    if (!org) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    const { id } = await params;
    if (!idSchema.safeParse(id).success) return NextResponse.json({ error: AUTOMATION_GONE }, { status: 404, headers });
    const supabase = await createServerClient();
    const exists = await supabase.from("automations").select("id").eq("organization_id", org.id).eq("id", id).maybeSingle();
    if (exists.error) throw exists.error;
    if (!exists.data) return NextResponse.json({ error: AUTOMATION_GONE }, { status: 404, headers });
    const runs = await listAutomationRuns(supabase, org.id, id);
    return NextResponse.json({ runs, canRerun: ["owner", "admin"].includes(org.role) }, { headers });
  } catch (error) {
    unstable_rethrow(error);
    console.error("automation runs api failed", (error as { code?: string } | null)?.code);
    return NextResponse.json({ error: AUTOMATION_RUNS_LOAD_FAILED }, { status: 500, headers });
  }
}
