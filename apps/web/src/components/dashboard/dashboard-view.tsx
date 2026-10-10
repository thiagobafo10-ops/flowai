"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { dashboardMetricsSchema, parsePeriod, type DashboardMetrics, type DashboardPeriod } from "@flowai/core";
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

type Props = {
  orgId: string;
  initialPeriod: DashboardPeriod;
  initialData: DashboardMetrics;
  initialDataUpdatedAt: number;
};

export function DashboardView({ orgId, initialPeriod, initialData, initialDataUpdatedAt }: Props) {
  const searchParams = useSearchParams();
  const period = parsePeriod(searchParams.get("periodo"));

  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ["dashboard", orgId, period],
    queryFn: () => fetchDashboard(period),
    initialData: period === initialPeriod ? initialData : undefined,
    initialDataUpdatedAt: period === initialPeriod ? initialDataUpdatedAt : undefined,
    staleTime: 30_000,
    // Ao voltar pela sidebar o cache pode ser de antes de um deal mudar: sempre revalida.
    refetchOnMount: "always",
    retry: false,
  });

  function changePeriod(next: DashboardPeriod) {
    // Só a URL muda (sem nova renderização no servidor): os dados vêm do React Query.
    // Com data=null o Next copia o state interno do histórico e sincroniza useSearchParams.
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
