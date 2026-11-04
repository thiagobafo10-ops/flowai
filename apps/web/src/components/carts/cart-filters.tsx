"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { cartsHref, type CartFilters, type CartPeriod } from "@/lib/carts/schemas";
import { COMMERCIAL_LABELS, STAGE_LABELS } from "@/lib/carts/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { selectClassName } from "@/components/crm/contact-dialog";

const PERIODS: Record<CartPeriod, string> = {
  all: "Todo o período", today: "Hoje", "7d": "Últimos 7 dias", "30d": "Últimos 30 dias", custom: "Personalizado",
};
const sel = `${selectClassName} w-auto`;

export function CartFiltersBar({ filters }: { filters: CartFilters }) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q);
  const lastPushed = useRef(filters.q);

  useEffect(() => {
    const value = q.trim();
    if (value === filters.q) return;
    const t = setTimeout(() => {
      lastPushed.current = value;
      router.replace(cartsHref(filters, { q: value, page: 1 }));
    }, 300);
    return () => clearTimeout(t);
  }, [q, filters, router]);

  useEffect(() => {
    if (filters.q !== lastPushed.current) {
      lastPushed.current = filters.q;
      setQ(filters.q);
    }
  }, [filters.q]);

  const go = (patch: Partial<CartFilters>) => router.push(cartsHref(filters, { ...patch, page: 1 }));
  const hasFilters = !!(filters.q || filters.period !== "all" || filters.commercialStatus || filters.recoveryStage || filters.eligible !== null);

  return (
    <div role="search" className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1">
        <SearchIcon className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
        <Input type="search" aria-label="Buscar carrinhos" placeholder="Buscar por nome, telefone ou e-mail"
          className="pl-8" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} />
      </div>
      <select aria-label="Período" className={sel} value={filters.period}
        onChange={(e) => go({ period: e.target.value as CartPeriod })}>
        {Object.entries(PERIODS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {filters.period === "custom" && (
        <>
          <Input type="date" aria-label="Data inicial" className="w-auto" value={filters.from}
            onChange={(e) => go({ from: e.target.value })} />
          <Input type="date" aria-label="Data final" className="w-auto" value={filters.to}
            onChange={(e) => go({ to: e.target.value })} />
        </>
      )}
      <select aria-label="Estado comercial" className={sel} value={filters.commercialStatus ?? ""}
        onChange={(e) => go({ commercialStatus: (e.target.value || null) as CartFilters["commercialStatus"] })}>
        <option value="">Todos os estados</option>
        {Object.entries(COMMERCIAL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <select aria-label="Estágio" className={sel} value={filters.recoveryStage ?? ""}
        onChange={(e) => go({ recoveryStage: (e.target.value || null) as CartFilters["recoveryStage"] })}>
        <option value="">Todos os estágios</option>
        {Object.entries(STAGE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <select aria-label="Elegibilidade" className={sel}
        value={filters.eligible === null ? "" : filters.eligible ? "sim" : "nao"}
        onChange={(e) => go({ eligible: e.target.value === "" ? null : e.target.value === "sim" })}>
        <option value="">Elegíveis e bloqueados</option>
        <option value="sim">Elegíveis para WhatsApp</option>
        <option value="nao">Bloqueados</option>
      </select>
      {hasFilters && (
        <Button type="button" variant="ghost" onClick={() => router.push("/carrinhos")}>Limpar filtros</Button>
      )}
    </div>
  );
}
