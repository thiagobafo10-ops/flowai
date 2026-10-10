import type { TagColor } from "@flowai/core";
import { cn } from "@/lib/utils";

// Classes literais (o Tailwind precisa vê-las por inteiro).
export const TAG_COLOR_CLASSES: Record<TagColor, string> = {
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  green: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-200",
  teal: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-200",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200",
  pink: "bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-200",
};

export function TagBadge({
  name,
  color,
  className,
}: {
  name: string;
  color: TagColor;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TAG_COLOR_CLASSES[color],
        className,
      )}
    >
      {name}
    </span>
  );
}
