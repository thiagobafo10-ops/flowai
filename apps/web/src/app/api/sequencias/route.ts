import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";
import { listSequences } from "@/lib/growth/queries";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const org = await getActiveOrg();
    if (!org) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    const payload = await listSequences(org.id);
    const canWrite = ["owner", "admin"].includes(org.role);
    return NextResponse.json({ ...payload, canWrite }, { headers });
  } catch (error) {
    unstable_rethrow(error);
    console.error("sequences api failed", error);
    return NextResponse.json({ error: "Não foi possível carregar as sequências." }, { status: 500, headers });
  }
}
