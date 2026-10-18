import type { ComponentProps } from "react";
import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = Omit<ComponentProps<typeof Link>, "className"> & { className?: string };

/**
 * Ação principal do painel: pílula escura com um círculo lima no lugar da seta.
 * Em tema escuro a pílula vira clara porque `--primary` é espelhado — o contraste se mantém.
 */
export function ActionLink({ className, children, ...props }: Props) {
  return (
    <Link
      className={cn(
        "group/action inline-flex h-11 shrink-0 items-center gap-3 rounded-full bg-primary pr-1.5 pl-5 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    >
      {children}
      <span
        aria-hidden="true"
        className="inline-flex size-8 items-center justify-center rounded-full bg-lime text-lime-foreground transition-transform group-hover/action:translate-x-0.5"
      >
        <ArrowUpRightIcon className="size-4" />
      </span>
    </Link>
  );
}
