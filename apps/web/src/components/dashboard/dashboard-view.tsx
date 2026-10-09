"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { dashboardMetricsSchema, type DashboardMetrics, type DashboardPeriod } from "@flowai/core";
import { Button } from "@/components/ui/button";
import { DashboardCharts } from "./charts";
import { DashboardSkeleton } from "./dashboard-skeleton";
import { GettingStartedBanner } from "./getting-started-banner";
import { KpiGrid } from "./kpi-grid";
import { PeriodSelector } from "./period-selector";

const ERROR_MESSAGE = "Não foi possível carregar o dashboard.";

async function fetchDashboard(period: DashboardPeriod): Promise<DashboardMetrics> {
  const res = await fetch(`/api/dashboard?periodo=${period}`, { cache: "no-store" });
  if (!res.ok) throw new Error(ERROR_MESSAGE);
  return dashboardMetricsSchema.parse(await res.json());
}

type Props = { orgId: string; initialPeriod: DashboardPeriod; initialData: DashboardMetrics };

export function DashboardView({ orgId, initialPeriod, initialData }: Props) {
  const [period, setPeriod] = useState<DashboardPeriod>(initialPeriod);

  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ["dashboard", orgId, period],
    queryFn: () => fetchDashboard(period),
    initialData: period === initialPeriod ? initialData : undefined,
    retry: false,
  });

  function changePeriod(next: DashboardPeriod) {
    setPeriod(next);
    // Só a URL muda (sem nova renderização no servidor): os dados vêm do React Query.
    window.history.replaceState(null, "", `?periodo=${next}`);
  }

  return (
    <div className="space-y-6">
      <PeriodSelector value={period} onChange={changePeriod} />
      {data ? (
        <>
          {!data.has_activity && <GettingStartedBanner />}
          <KpiGrid data={data} period={period} />
          <DashboardCharts data={data} />
        </>
      ) : isError ? (
        <div className="flex flex-col items-start gap-3 rounded-xl p-4 ring-1 ring-foreground/10">
          <p role="alert" className="text-sm">
            {ERROR_MESSAGE}
          </p>
          <Button type="button" variant="outline" disabled={isFetching} onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <DashboardSkeleton />
      )}
    </div>
  );
}
