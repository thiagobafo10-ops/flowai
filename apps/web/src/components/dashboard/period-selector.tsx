"use client";

import type { KeyboardEvent } from "react";
import { PERIOD_OPTIONS, type DashboardPeriod } from "@flowai/core";
import { cn } from "@/lib/utils";

type Props = { value: DashboardPeriod; onChange: (p: DashboardPeriod) => void };

export function PeriodSelector({ value, onChange }: Props) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const delta =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (delta === 0) return;
    e.preventDefault();
    const i = PERIOD_OPTIONS.findIndex((o) => o.value === value);
    const n = (i + delta + PERIOD_OPTIONS.length) % PERIOD_OPTIONS.length;
    onChange(PERIOD_OPTIONS[n].value);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[n]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Período"
      onKeyDown={onKeyDown}
      className="inline-flex h-11 items-center gap-1 rounded-full bg-card p-1 shadow-soft"
    >
      {PERIOD_OPTIONS.map((o) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-9 rounded-full px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
              checked
                ? "bg-primary text-primary-foreground"
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
