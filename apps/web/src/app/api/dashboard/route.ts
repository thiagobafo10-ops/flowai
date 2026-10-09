import { NextResponse, type NextRequest } from "next/server";
import { parsePeriod } from "@flowai/core";
import { getActiveOrg } from "@/lib/org/active-org";
import { getDashboardMetrics } from "@/lib/dashboard/get-dashboard-metrics";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  try {
    const org = await getActiveOrg();
    if (!org) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    }
    const period = parsePeriod(request.nextUrl.searchParams.get("periodo"));
    const metrics = await getDashboardMetrics(org.id, period);
    return NextResponse.json(metrics, { headers });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível carregar o dashboard." },
      { status: 500, headers },
    );
  }
}
