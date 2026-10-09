export type DashboardPeriod = "hoje" | "7d" | "30d";

export function parsePeriod(value: string | string[] | undefined | null): DashboardPeriod {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "hoje" || v === "7d" || v === "30d" ? v : "7d";
}

export function periodToDays(p: DashboardPeriod): 1 | 7 | 30 {
  return p === "hoje" ? 1 : p === "7d" ? 7 : 30;
}

export function periodLabel(p: DashboardPeriod): string {
  return p === "hoje" ? "hoje" : p === "7d" ? "últimos 7 dias" : "últimos 30 dias";
}

export const PERIOD_OPTIONS: { value: DashboardPeriod; label: "Hoje" | "7 dias" | "30 dias" }[] = [
  { value: "hoje", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
];
