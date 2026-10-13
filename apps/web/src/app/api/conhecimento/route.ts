import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";
import { listKnowledgeDocuments } from "@/lib/ai/queries";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const org = await getActiveOrg();
    if (!org) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    const documents = await listKnowledgeDocuments(org.id);
    return NextResponse.json({ documents, canWrite: ["owner", "admin"].includes(org.role) }, { headers });
  } catch (error) {
    unstable_rethrow(error);
    console.error("knowledge api failed", error);
    return NextResponse.json({ error: "Não foi possível carregar os documentos." }, { status: 500, headers });
  }
}
