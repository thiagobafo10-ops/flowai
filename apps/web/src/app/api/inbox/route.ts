import { NextResponse, type NextRequest } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { parseInboxParams } from "@flowai/core";
import { getActiveOrg } from "@/lib/org/active-org";
import { listConversations } from "@/lib/inbox/queries";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  try {
    const org = await getActiveOrg();
    if (!org) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    }
    const sp = Object.fromEntries(request.nextUrl.searchParams);
    const { tab, q, channelId } = parseInboxParams(sp);
    const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
    const result = await listConversations(org.id, { tab, q, channelId, cursor });
    return NextResponse.json(result, { headers });
  } catch (err) {
    unstable_rethrow(err);
    console.error("inbox api failed", err);
    return NextResponse.json({ error: "Não foi possível carregar o Inbox." }, { status: 500, headers });
  }
}
