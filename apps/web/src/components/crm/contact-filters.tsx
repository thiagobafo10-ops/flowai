"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import {
  CONTACT_SOURCE_LABELS,
  CONTACT_STATUS_LABELS,
  type ContactFilters,
  type ContactOrder,
} from "@flowai/core";
import { contactsHref } from "@/lib/crm/url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { selectClassName } from "./contact-dialog";

const ORDER_LABELS: Record<ContactOrder, string> = {
  interacao: "Última interação",
  nome: "Nome",
  criado: "Mais recentes",
  score: "Lead score",
};

type Props = {
  filters: ContactFilters;
  tags: { id: string; name: string }[];
  members: { userId: string; name: string }[];
};

export function ContactFiltersBar({ filters, tags, members }: Props) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q);
  const lastPushed = useRef(filters.q);

  // Busca com atraso; sempre volta para a página 1.
  useEffect(() => {
    const value = q.trim();
    if (value === filters.q) return;
    const t = setTimeout(() => {
      lastPushed.current = value;
      router.replace(contactsHref(filters, { q: value, page: 1 }));
    }, 300);
    return () => clearTimeout(t);
  }, [q, filters, router]);

  // URL alterada por fora (ex.: "Limpar filtros"): reflete no campo.
  useEffect(() => {
    if (filters.q !== lastPushed.current) {
      lastPushed.current = filters.q;
      setQ(filters.q);
    }
  }, [filters.q]);

  const go = (patch: Partial<ContactFilters>) =>
    router.push(contactsHref(filters, { ...patch, page: 1 }));

  const hasFilters = !!(filters.q || filters.status || filters.tagId || filters.assignee || filters.source);

  return (
    <div role="search" className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1">
        <SearchIcon className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Buscar contatos"
          placeholder="Buscar por nome, telefone ou e-mail"
          className="pl-8"
          value={q}
          maxLength={100}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <select
        aria-label="Status"
        className={`${selectClassName} w-auto`}
        value={filters.status ?? ""}
        onChange={(e) => go({ status: (e.target.value || null) as ContactFilters["status"] })}
      >
        <option value="">Todos os status</option>
        {Object.entries(CONTACT_STATUS_LABELS).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <select
        aria-label="Tag"
        className={`${selectClassName} w-auto`}
        value={filters.tagId ?? ""}
        onChange={(e) => go({ tagId: e.target.value || null })}
      >
        <option value="">Todas as tags</option>
        {tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Responsável"
        className={`${selectClassName} w-auto`}
        value={filters.assignee ?? ""}
        onChange={(e) => go({ assignee: e.target.value || null })}
      >
        <option value="">Todos os responsáveis</option>
        <option value="nenhum">Sem responsável</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Origem"
        className={`${selectClassName} w-auto`}
        value={filters.source ?? ""}
        onChange={(e) => go({ source: (e.target.value || null) as ContactFilters["source"] })}
      >
        <option value="">Todas as origens</option>
        {Object.entries(CONTACT_SOURCE_LABELS).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <select
        aria-label="Ordenar por"
        className={`${selectClassName} w-auto`}
        value={filters.order}
        onChange={(e) => go({ order: e.target.value as ContactOrder })}
      >
        {Object.entries(ORDER_LABELS).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {hasFilters && (
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            router.push(
              contactsHref(filters, { q: "", status: null, tagId: null, assignee: null, source: null, page: 1 }),
            )
          }
        >
          Limpar filtros
        </Button>
      )}
    </div>
  );
}
