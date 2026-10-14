export function AnalyticsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando métricas" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="h-8 w-64 animate-pulse rounded-lg bg-muted" />
        <div className="flex gap-2">
          <div className="h-8 w-28 animate-pulse rounded-lg bg-muted" />
          <div className="h-8 w-28 animate-pulse rounded-lg bg-muted" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl border bg-muted/40" />
        ))}
      </div>

      <div className="h-10 w-80 animate-pulse rounded-lg bg-muted" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-80 animate-pulse rounded-xl border bg-muted/30" />
        <div className="h-80 animate-pulse rounded-xl border bg-muted/30" />
      </div>
    </div>
  );
}
