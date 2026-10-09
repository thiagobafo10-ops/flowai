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
      className="inline-flex rounded-lg bg-muted p-1"
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
