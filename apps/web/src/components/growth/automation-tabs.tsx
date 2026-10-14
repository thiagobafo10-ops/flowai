"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/automacoes", label: "Fluxos", exact: true },
  { href: "/automacoes/links", label: "Links de entrada", exact: false },
  { href: "/automacoes/sequencias", label: "Sequências", exact: false },
  { href: "/automacoes/campanhas", label: "Campanhas", exact: false },
];

export function AutomationTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Seções de automações" className="flex gap-1 border-b">
      {tabs.map((t) => {
        const active = t.exact
          ? pathname === t.href || (pathname.startsWith("/automacoes/") && !tabs.slice(1).some((o) => pathname.startsWith(o.href)))
          : pathname === t.href || pathname.startsWith(`${t.href}/`);

        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
