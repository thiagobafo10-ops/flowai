import { Card } from "@/components/ui/card";

type Props = { title: string; value: string; caption: string };

export function KpiCard({ title, value, caption }: Props) {
  return (
    <Card role="group" aria-label={title} className="gap-1 px-4">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{caption}</p>
    </Card>
  );
}
