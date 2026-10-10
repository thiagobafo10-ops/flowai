"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function SettingsTabs({ showPipeline }: { showPipeline: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { href: "/configuracoes/tags", label: "Tags" },
    ...(showPipeline
      ? [
          { href: "/configuracoes/pipeline", label: "Pipeline" },
          { href: "/configuracoes/canais", label: "Canais" },
        ]
      : []),
  ];
  return (
    <nav aria-label="Seções de configurações" className="flex gap-1 border-b">
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
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
