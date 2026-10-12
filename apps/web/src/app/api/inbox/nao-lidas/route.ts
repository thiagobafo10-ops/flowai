import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";
import { getUnreadCount } from "@/lib/inbox/unread-queries";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const org = await getActiveOrg();
    if (!org) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    return NextResponse.json({ count: await getUnreadCount(org.id) }, { headers });
  } catch (error) {
    unstable_rethrow(error);
    console.error("unread count failed", error);
    return NextResponse.json({ error: "Não foi possível carregar o Inbox." }, { status: 500, headers });
  }
}
