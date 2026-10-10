import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CONTACTS_PAGE_SIZE, parseContactFilters, type SearchParams } from "@flowai/core";
import { ContactFiltersBar } from "@/components/crm/contact-filters";
import { NewContactButton } from "@/components/crm/contact-dialog";
import { ContactTable } from "@/components/crm/contact-table";
import { RequireOrg } from "@/components/require-org";
import { buttonVariants } from "@/components/ui/button";
import { getActiveOrg } from "@/lib/org/active-org";
import { listContacts, listMembers, listTags } from "@/lib/crm/queries";
import { contactsHref } from "@/lib/crm/url";
import { cn } from "@/lib/utils";

type Props = { searchParams: Promise<SearchParams> };

function ContactsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando contatos" className="space-y-3 pt-4">
      <div className="h-8 animate-pulse rounded-lg bg-muted" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/60" />
      ))}
    </div>
  );
}

async function ContactsContent({ searchParams }: Props) {
  const filters = parseContactFilters(await searchParams);
  const org = await getActiveOrg();
  if (!org) return null;

  const [{ rows, total }, tags, members] = await Promise.all([
    listContacts(org.id, filters),
    listTags(org.id),
    listMembers(org.id),
  ]);

  // Página além do fim: o banco não devolve total_count; volta para a primeira.
  if (filters.page > 1 && rows.length === 0) redirect(contactsHref(filters, { page: 1 }));

  const canCreate = org.role !== "viewer";
  const hasFilters = !!(filters.q || filters.status || filters.tagId || filters.assignee || filters.source);
  const totalPages = Math.max(1, Math.ceil(total / CONTACTS_PAGE_SIZE));
  const newButton = canCreate ? <NewContactButton tags={tags} members={members} /> : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground">
          {total === 1 ? "1 contato" : `${total} contatos`}
        </p>
        {newButton}
      </div>

      {(total > 0 || hasFilters) && (
        <ContactFiltersBar filters={filters} tags={tags} members={members} />
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
          {hasFilters ? (
            <>
              <p className="font-medium">Nenhum contato encontrado</p>
              <Link href="/contatos" className={buttonVariants({ variant: "outline" })}>
                Limpar filtros
              </Link>
            </>
          ) : (
            <>
              <p className="font-medium">Nenhum contato ainda</p>
              {newButton}
            </>
          )}
        </div>
      ) : (
        <>
          <ContactTable rows={rows} tags={tags} members={members} />
          <nav aria-label="Paginação" className="flex items-center justify-between gap-2">
            {filters.page > 1 ? (
              <Link href={contactsHref(filters, { page: filters.page - 1 })} className={buttonVariants({ variant: "outline" })}>
                Anterior
              </Link>
            ) : (
              <span aria-disabled="true" className={cn(buttonVariants({ variant: "outline" }), "pointer-events-none opacity-50")}>
                Anterior
              </span>
            )}
            <span className="text-sm text-muted-foreground">
              Página {filters.page} de {totalPages}
            </span>
            {filters.page < totalPages ? (
              <Link href={contactsHref(filters, { page: filters.page + 1 })} className={buttonVariants({ variant: "outline" })}>
                Próxima
              </Link>
            ) : (
              <span aria-disabled="true" className={cn(buttonVariants({ variant: "outline" }), "pointer-events-none opacity-50")}>
                Próxima
              </span>
            )}
          </nav>
        </>
      )}
    </div>
  );
}

export default function ContactsPage(props: Props) {
  return (
    <RequireOrg>
      <main className="space-y-2 p-6">
        <h1 className="text-2xl font-semibold">Contatos</h1>
        <Suspense fallback={<ContactsSkeleton />}>
          <ContactsContent {...props} />
        </Suspense>
      </main>
    </RequireOrg>
  );
}
