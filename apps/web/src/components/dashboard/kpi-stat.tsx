import { cn } from "@/lib/utils";

type StatProps = {
  title: string;
  value: string;
  caption: string;
  /** `hero` para o número que abre o cartão, `inline` para métricas de apoio. */
  size?: "hero" | "inline";
};

/**
 * Indicador do painel. Todo indicador é um `group` rotulado: leitores de tela e testes
 * encontram a métrica pelo nome ("Conversas hoje"), não pela posição no layout.
 */
export function KpiStat({ title, value, caption, size = "inline" }: StatProps) {
  return (
    <div role="group" aria-label={title} className="flex min-w-0 flex-col gap-0.5">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <p
        className={cn(
          "font-semibold tracking-tight tabular-nums",
          size === "hero" ? "text-4xl leading-none" : "text-2xl leading-none",
        )}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}

type ProgressProps = { title: string; value: string; caption: string; ratio: number | null };

/** Métrica percentual com barra de preenchimento em lima (fração de 0 a 1). */
export function KpiProgress({ title, value, caption, ratio }: ProgressProps) {
  const percent = ratio === null ? 0 : Math.max(0, Math.min(100, ratio * 100));
  return (
    <div role="group" aria-label={title} className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <p className="text-base font-semibold tracking-tight tabular-nums">{value}</p>
      </div>
      {/* A barra repete o texto ao lado, então fica fora da árvore de acessibilidade. */}
      <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-lime" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}
