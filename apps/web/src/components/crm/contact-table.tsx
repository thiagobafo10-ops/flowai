import Link from "next/link";
import {
  CONTACT_SOURCE_LABELS,
  CONTACT_STATUS_LABELS,
  contactDisplayName,
  formatBrazilianPhone,
  type ContactStatus,
} from "@flowai/core";
import type { ContactRow, MemberOption, TagOption } from "@/lib/crm/queries";
import { cn } from "@/lib/utils";
import { TagBadge } from "./tag-badge";

const EMPTY = "—";

const STATUS_CLASSES: Record<ContactStatus, string> = {
  lead: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200",
  customer: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-200",
  inactive: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const chars = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0] ?? "?"];
  return chars.map((p) => p.charAt(0).toUpperCase()).join("");
}

function formatDateTime(iso: string | null): string {
  if (!iso) return EMPTY;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
    >
      {initials(name)}
    </span>
  );
}

function StatusBadge({ status }: { status: ContactStatus }) {
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASSES[status])}>
      {CONTACT_STATUS_LABELS[status]}
    </span>
  );
}

type Props = { rows: ContactRow[]; tags: TagOption[]; members: MemberOption[] };

export function ContactTable({ rows, tags, members }: Props) {
  const tagById = new Map(tags.map((t) => [t.id, t]));
  const memberById = new Map(members.map((m) => [m.userId, m.name]));
  const tagsOf = (r: ContactRow) =>
    r.tagIds.map((id) => tagById.get(id)).filter((t): t is TagOption => !!t);
  const assignee = (r: ContactRow) => (r.assignedTo ? (memberById.get(r.assignedTo) ?? EMPTY) : EMPTY);

  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              {["Nome", "Telefone", "E-mail", "Status", "Lead score", "Tags", "Responsável", "Última interação", "Origem"].map(
                (h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const name = contactDisplayName(r);
              return (
                <tr key={r.id} className="relative border-t hover:bg-muted/40">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Avatar name={name} />
                      <Link
                        href={`/contatos/${r.id}`}
                        className="font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
                      >
                        {name}
                      </Link>
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.phone ? formatBrazilianPhone(r.phone) : EMPTY}</td>
                  <td className="px-3 py-2">{r.email ?? EMPTY}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-2 tabular-nums">{r.leadScore}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {tagsOf(r).length === 0
                        ? EMPTY
                        : tagsOf(r).map((t) => <TagBadge key={t.id} name={t.name} color={t.color} />)}
                    </div>
                  </td>
                  <td className="px-3 py-2">{assignee(r)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(r.lastInteractionAt)}</td>
                  <td className="px-3 py-2">{CONTACT_SOURCE_LABELS[r.source]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden">
        {rows.map((r) => {
          const name = contactDisplayName(r);
          return (
            <li key={r.id} className="relative rounded-xl border p-3 hover:bg-muted/40">
              <div className="flex items-center gap-2">
                <Avatar name={name} />
                <Link
                  href={`/contatos/${r.id}`}
                  className="min-w-0 flex-1 truncate font-medium after:absolute after:inset-0 after:content-['']"
                >
                  {name}
                </Link>
                <StatusBadge status={r.status} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                {tagsOf(r).map((t) => (
                  <TagBadge key={t.id} name={t.name} color={t.color} />
                ))}
                <span className="ml-auto">Responsável: {assignee(r)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
