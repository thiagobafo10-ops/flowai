import { Suspense } from "react";
import { parsePeriod } from "@flowai/core";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { getDashboardMetrics } from "@/lib/dashboard/get-dashboard-metrics";
import { nowMs } from "@/lib/dashboard/now";
import { getActiveOrg } from "@/lib/org/active-org";

type Props = { searchParams: Promise<{ periodo?: string | string[] }> };

async function DashboardContent({ searchParams }: Props) {
  const period = parsePeriod((await searchParams).periodo);
  const org = await getActiveOrg();
  if (!org) return null;
  const data = await getDashboardMetrics(org.id, period);
  return (
    <DashboardView
      key={org.id}
      orgId={org.id}
      orgName={org.name}
      initialPeriod={period}
      initialData={data}
      initialDataUpdatedAt={nowMs()}
    />
  );
}

export default function DashboardPage(props: Props) {
  return (
    <main className="p-6">
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent {...props} />
      </Suspense>
    </main>
  );
}
