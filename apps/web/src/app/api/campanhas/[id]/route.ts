import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";
import { getCampaign, getCampaignReport, loadCampaignFilterRefs } from "@/lib/growth/queries";
import { deleteCampaign, saveCampaignDraft } from "@/lib/growth/actions";

const headers = { "Cache-Control": "no-store" };

function paginationInteger(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null || !/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min) return fallback;
  return Math.min(value, max);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const org = await getActiveOrg();
    if (!org) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    const { id } = await params;

    const [campaign, refs] = await Promise.all([
      getCampaign(org.id, id),
      loadCampaignFilterRefs(org.id),
    ]);

    if (!campaign) return NextResponse.json({ error: "not_found" }, { status: 404, headers });

    let report = null;
    if (campaign.status !== "draft") {
      const searchParams = new URL(request.url).searchParams;
      const limit = paginationInteger(searchParams.get("limit"), 50, 1, 100);
      // campaign_report recebe int PostgreSQL e aceita somente offset não negativo.
      const offset = paginationInteger(searchParams.get("offset"), 0, 0, 2147483647);
      report = await getCampaignReport(id, limit, offset);
    }

    const canWrite = ["owner", "admin"].includes(org.role);
    return NextResponse.json({ campaign, refs, report, canWrite }, { headers });
  } catch (error) {
    unstable_rethrow(error);
    console.error("campaign detail api failed", error);
    return NextResponse.json({ error: "Não foi possível carregar os detalhes da campanha." }, { status: 500, headers });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const org = await getActiveOrg();
    if (!org) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    if (!["owner", "admin"].includes(org.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403, headers });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const res = await saveCampaignDraft({ ...body, id });
    if (!res.ok) {
      return NextResponse.json({ error: res.error, fieldErrors: res.fieldErrors }, { status: 400, headers });
    }

    return NextResponse.json({ ok: true }, { headers });
  } catch (error) {
    unstable_rethrow(error);
    console.error("update campaign api failed", error);
    return NextResponse.json({ error: "Não foi possível atualizar a campanha." }, { status: 500, headers });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const org = await getActiveOrg();
    if (!org) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    if (!["owner", "admin"].includes(org.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403, headers });
    }

    const { id } = await params;
    const res = await deleteCampaign(id);
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: 400, headers });
    }

    return NextResponse.json({ ok: true }, { headers });
  } catch (error) {
    unstable_rethrow(error);
    console.error("delete campaign api failed", error);
    return NextResponse.json({ error: "Não foi possível excluir a campanha." }, { status: 500, headers });
  }
}
