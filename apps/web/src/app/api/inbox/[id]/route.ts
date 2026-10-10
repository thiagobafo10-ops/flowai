import { NextResponse, type NextRequest } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";
import { getConversation } from "@/lib/inbox/queries";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getActiveOrg();
    if (!org) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    }
    const { id } = await params;
    const before = request.nextUrl.searchParams.get("antes") ?? undefined;
    const result = await getConversation(org.id, id, before);
    if (!result) {
      return NextResponse.json({ error: "Esta conversa não existe mais." }, { status: 404, headers });
    }
    return NextResponse.json(result, { headers });
  } catch (err) {
    unstable_rethrow(err);
    console.error("inbox conversation api failed", err);
    return NextResponse.json({ error: "Não foi possível carregar a conversa." }, { status: 500, headers });
  }
}
