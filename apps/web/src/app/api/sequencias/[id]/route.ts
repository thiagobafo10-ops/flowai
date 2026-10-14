import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";
import { getSequence } from "@/lib/growth/queries";

const headers = { "Cache-Control": "no-store" };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const org = await getActiveOrg();
    if (!org) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    const { id } = await params;
    const sequence = await getSequence(org.id, id);
    if (!sequence) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
    const canWrite = ["owner", "admin"].includes(org.role);
    return NextResponse.json({ sequence, canWrite }, { headers });
  } catch (error) {
    unstable_rethrow(error);
    console.error("sequence detail api failed", error);
    return NextResponse.json({ error: "Não foi possível carregar os detalhes da sequência." }, { status: 500, headers });
  }
}
