import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";
import { listAutomations } from "@/lib/automation/queries";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const org = await getActiveOrg();
    if (!org) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    const automations = await listAutomations(org.id);
    return NextResponse.json({ automations, canWrite: ["owner", "admin"].includes(org.role) }, { headers });
  } catch (error) {
    unstable_rethrow(error);
    console.error("automations api failed", error);
    return NextResponse.json({ error: "Não foi possível carregar as automações." }, { status: 500, headers });
  }
}
