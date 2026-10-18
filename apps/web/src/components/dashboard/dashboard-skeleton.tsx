const BLOCKS = [
  "col-span-12 h-72 md:col-span-6 xl:col-span-3",
  "col-span-12 h-72 xl:col-span-6",
  "col-span-12 h-72 md:col-span-6 xl:col-span-3",
  "col-span-12 h-72 md:col-span-6 xl:col-span-3",
  "col-span-12 h-72 xl:col-span-5",
  "col-span-12 h-72 xl:col-span-4",
];

export function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Carregando dashboard">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-3">
          <div className="h-5 w-32 animate-pulse rounded-full bg-card" />
          <div className="h-9 w-64 animate-pulse rounded-full bg-card" />
        </div>
        <div className="h-11 w-72 animate-pulse rounded-full bg-card" />
      </div>
      <div className="grid grid-cols-12 grid-flow-row-dense gap-4">
        {BLOCKS.map((className) => (
          <div key={className} className={`animate-pulse rounded-xl bg-card shadow-soft ${className}`} />
        ))}
      </div>
    </div>
  );
}
