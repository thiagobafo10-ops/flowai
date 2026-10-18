import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const orbVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-full transition-colors [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      tone: {
        // O acento do produto: sempre como preenchimento, com texto/ícone escuro por cima.
        lime: "bg-lime text-lime-foreground shadow-[0_10px_24px_-14px_var(--lime)]",
        dark: "bg-primary text-primary-foreground",
        muted: "bg-muted text-foreground",
        outline: "bg-card text-foreground ring-1 ring-border",
      },
      size: {
        sm: "size-7",
        md: "size-9",
        lg: "size-12",
      },
    },
    defaultVariants: { tone: "lime", size: "md" },
  },
);

type Props = ComponentProps<"span"> & VariantProps<typeof orbVariants>;

/** Círculo com ícone. É o "selo" visual do painel: marca o item ativo da navegação e dá peso aos cartões. */
export function IconOrb({ tone, size, className, ...props }: Props) {
  return <span data-slot="icon-orb" className={cn(orbVariants({ tone, size }), className)} {...props} />;
}
