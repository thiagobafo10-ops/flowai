import { NextResponse, type NextRequest } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { parseAnalyticsPeriod } from "@flowai/core";
import { getActiveOrg } from "@/lib/org/active-org";
import { getAnalyticsMetrics } from "@/lib/analytics/queries";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  try {
    const org = await getActiveOrg();
    if (!org) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    }

    const period = parseAnalyticsPeriod(request.nextUrl.searchParams.get("periodo"));
    const channelId = request.nextUrl.searchParams.get("canal");

    const metrics = await getAnalyticsMetrics(org.id, period, channelId);
    return NextResponse.json(metrics, { headers });
  } catch (err) {
    unstable_rethrow(err);
    console.error("analytics api failed", err);
    return NextResponse.json(
      { error: "Não foi possível carregar as métricas de analytics." },
      { status: 500, headers },
    );
  }
}
