import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServerClient } from "@/lib/supabase/server";
import { loadAutomation, loadEditorRefs } from "@/lib/automation/queries";
import { AUTOMATION_GONE, AUTOMATION_LOAD_FAILED } from "@/lib/automation/messages";

const headers = { "Cache-Control": "no-store" };
const idSchema = z.uuid();

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getActiveOrg();
    if (!org) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    const { id } = await params;
    if (!idSchema.safeParse(id).success) return NextResponse.json({ error: AUTOMATION_GONE }, { status: 404, headers });
    const supabase = await createServerClient();
    const [automation, refs] = await Promise.all([loadAutomation(supabase, org.id, id), loadEditorRefs(supabase, org.id)]);
    if (!automation) return NextResponse.json({ error: AUTOMATION_GONE }, { status: 404, headers });
    const { graph, ...rest } = automation;
    return NextResponse.json(
      {
        automation: {
          id: rest.id,
          name: rest.name,
          status: rest.status,
          triggerType: rest.triggerType,
          triggerConfig: rest.triggerConfig,
          currentVersion: rest.currentVersion,
        },
        graph,
        refs,
        canWrite: ["owner", "admin"].includes(org.role),
      },
      { headers },
    );
  } catch (error) {
    unstable_rethrow(error);
    console.error("automation detail api failed", (error as { code?: string } | null)?.code);
    return NextResponse.json({ error: AUTOMATION_LOAD_FAILED }, { status: 500, headers });
  }
}
