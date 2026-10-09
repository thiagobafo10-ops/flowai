"use client";

import { PERIOD_OPTIONS, type DashboardPeriod } from "@flowai/core";
import { cn } from "@/lib/utils";

type Props = { value: DashboardPeriod; onChange: (p: DashboardPeriod) => void };

export function PeriodSelector({ value, onChange }: Props) {
  return (
    <div role="radiogroup" aria-label="Período" className="inline-flex rounded-lg bg-muted p-1">
      {PERIOD_OPTIONS.map((o) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              checked
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
