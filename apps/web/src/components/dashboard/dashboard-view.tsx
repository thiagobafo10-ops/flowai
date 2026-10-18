"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { SparklesIcon } from "lucide-react";
import {
  dashboardMetricsSchema,
  parsePeriod,
  type DashboardMetrics,
  type DashboardPeriod,
} from "@flowai/core";
import { ActionLink } from "@/components/ui/action-link";
import { Button } from "@/components/ui/button";
import { IconOrb } from "@/components/ui/icon-orb";
import { AiVsHandoffChart, ConversationsChart, FunnelChart } from "./charts";
import { DashboardSkeleton } from "./dashboard-skeleton";
import { GettingStartedBanner } from "./getting-started-banner";
import { PipelineCard, PulseCard, ServiceCard } from "./kpi-cards";
import { PeriodSelector } from "./period-selector";

const ERROR_MESSAGE = "Não foi possível carregar o dashboard.";

async function fetchDashboard(period: DashboardPeriod): Promise<DashboardMetrics> {
  const res = await fetch(`/api/dashboard?periodo=${period}`, { cache: "no-store" });
  if (!res.ok) throw new Error(ERROR_MESSAGE);
  return dashboardMetricsSchema.parse(await res.json());
}

type Props = {
  orgId: string;
  orgName: string;
  initialPeriod: DashboardPeriod;
  initialData: DashboardMetrics;
  initialDataUpdatedAt: number;
};

export function DashboardView({
  orgId,
  orgName,
  initialPeriod,
  initialData,
  initialDataUpdatedAt,
}: Props) {
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl leading-tight tracking-tight sm:text-4xl">
            <span className="block font-normal text-muted-foreground">{orgName}</span>
            <span className="block font-semibold">Resumo do seu negócio</span>
          </h1>
          <IconOrb size="lg" aria-hidden="true">
            <SparklesIcon className="size-5" />
          </IconOrb>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PeriodSelector value={period} onChange={changePeriod} />
          <ActionLink href="/inbox">Abrir Inbox</ActionLink>
        </div>
      </div>
      {data ? (
        <div className="grid grid-cols-12 grid-flow-row-dense gap-4">
          {!data.has_activity && <GettingStartedBanner />}
          <PulseCard data={data} period={period} />
          <ConversationsChart data={data} />
          <PipelineCard data={data} period={period} />
          <ServiceCard data={data} period={period} />
          <FunnelChart data={data} />
          <AiVsHandoffChart data={data} />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-start gap-3 rounded-xl bg-card p-5 shadow-soft">
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
