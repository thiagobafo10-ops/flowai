import { NextResponse, type NextRequest } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";
import { getContactPanel } from "@/lib/inbox/contact-queries";

const headers = { "Cache-Control": "no-store" };
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getActiveOrg();
    if (!org) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    const { id } = await params;
    const data = await getContactPanel(org.id, id, request.nextUrl.searchParams.get("c") ?? "");
    if (!data) return NextResponse.json({ error: "Esta conversa não existe mais." }, { status: 404, headers });
    return NextResponse.json(data, { headers });
  } catch (error) {
    unstable_rethrow(error);
    console.error("inbox contact api failed", error);
    return NextResponse.json({ error: "Não foi possível concluir. Tente novamente." }, { status: 500, headers });
  }
}
