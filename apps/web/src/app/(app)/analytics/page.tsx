import { Suspense } from "react";
import { parseAnalyticsPeriod } from "@flowai/core";
import { RequireOrg } from "@/components/require-org";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServerClient } from "@/lib/supabase/server";
import { getAnalyticsMetrics } from "@/lib/analytics/queries";
import { AnalyticsView } from "@/components/analytics/analytics-view";
import { AnalyticsSkeleton } from "@/components/analytics/analytics-skeleton";

type Props = {
  searchParams: Promise<{ periodo?: string | string[]; canal?: string | string[] }>;
};

async function AnalyticsContent({ searchParams }: Props) {
  const org = await getActiveOrg();
  if (!org) return null;

  const sp = await searchParams;
  const period = parseAnalyticsPeriod(Array.isArray(sp.periodo) ? sp.periodo[0] : sp.periodo);
  const channelId = Array.isArray(sp.canal) ? sp.canal[0] : sp.canal;

  const supabase = await createServerClient();
  const [{ data: channelsData }, metrics] = await Promise.all([
    supabase.from("channels").select("id, name, type").eq("organization_id", org.id).order("name"),
    getAnalyticsMetrics(org.id, period, channelId),
  ]);

  const channels = (channelsData ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
  }));

  return (
    <AnalyticsView
      key={`${org.id}-${period}`}
      orgId={org.id}
      initialPeriod={period}
      initialData={metrics}
      channels={channels}
    />
  );
}

export default function AnalyticsPage(props: Props) {
  return (
    <RequireOrg>
      <main className="space-y-4 p-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Analytics</h1>
          <p className="max-w-prose text-muted-foreground text-sm">
            Indicadores de atendimento, inteligência artificial e conversão de vendas.
          </p>
        </div>
        <Suspense fallback={<AnalyticsSkeleton />}>
          <AnalyticsContent {...props} />
        </Suspense>
      </main>
    </RequireOrg>
  );
}
