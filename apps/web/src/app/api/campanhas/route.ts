import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";
import { listCampaigns, loadCampaignFilterRefs } from "@/lib/growth/queries";
import { saveCampaignDraft } from "@/lib/growth/actions";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const org = await getActiveOrg();
    if (!org) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    const [campaigns, refs] = await Promise.all([
      listCampaigns(org.id),
      loadCampaignFilterRefs(org.id),
    ]);
    const canWrite = ["owner", "admin"].includes(org.role);
    return NextResponse.json({ campaigns, refs, canWrite }, { headers });
  } catch (error) {
    unstable_rethrow(error);
    console.error("campaigns api failed", error);
    return NextResponse.json({ error: "Não foi possível carregar as campanhas." }, { status: 500, headers });
  }
}

export async function POST(request: Request) {
  try {
    const org = await getActiveOrg();
    if (!org) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    if (!["owner", "admin"].includes(org.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403, headers });
    }

    const body = await request.json().catch(() => ({}));
    const res = await saveCampaignDraft(body);
    if (!res.ok) {
      return NextResponse.json({ error: res.error, fieldErrors: res.fieldErrors }, { status: 400, headers });
    }

    return NextResponse.json({ id: res.data.id }, { status: 201, headers });
  } catch (error) {
    unstable_rethrow(error);
    console.error("create campaign api failed", error);
    return NextResponse.json({ error: "Não foi possível criar o rascunho da campanha." }, { status: 500, headers });
  }
}
