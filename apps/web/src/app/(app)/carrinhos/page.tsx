import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CartFiltersBar } from "@/components/carts/cart-filters";
import { CartTable } from "@/components/carts/cart-table";
import { RequireOrg } from "@/components/require-org";
import { buttonVariants } from "@/components/ui/button";
import { listCarts } from "@/lib/carts/queries";
import { cartsHref, parseCartFilters, type SearchParams } from "@/lib/carts/schemas";
import { getOrgTimezone } from "@/lib/crm/queries";
import { getActiveOrg } from "@/lib/org/active-org";
import { cn } from "@/lib/utils";

type Props = { searchParams: Promise<SearchParams> };

function CartsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando carrinhos" className="space-y-3 pt-4">
      <div className="h-8 animate-pulse rounded-lg bg-muted" />
      {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/60" />)}
    </div>
  );
}

const disabled = cn(buttonVariants({ variant: "outline" }), "pointer-events-none opacity-50");

async function CartsContent({ searchParams }: Props) {
  const filters = parseCartFilters(await searchParams);
  const org = await getActiveOrg();
  if (!org) return null;

  const hasFilters = !!(filters.q || filters.period !== "all" || filters.commercialStatus || filters.recoveryStage || filters.eligible !== null);
  if (filters.error) {
    return (
      <div className="space-y-4">
        <CartFiltersBar filters={filters} />
        <p role="alert" className="text-sm text-destructive">{filters.error}</p>
      </div>
    );
  }
  const [{ rows, total }, timeZone] = await Promise.all([listCarts(org.id, filters), getOrgTimezone(org.id)]);
  if (filters.page > 1 && rows.length === 0) redirect(cartsHref(filters, { page: 1 }));
  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">{total === 1 ? "1 carrinho" : `${total} carrinhos`}</p>
      {(total > 0 || hasFilters) && <CartFiltersBar filters={filters} />}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
          {hasFilters ? (
            <>
              <p className="font-medium">Nenhum carrinho encontrado</p>
              <Link href="/carrinhos" className={buttonVariants({ variant: "outline" })}>Limpar filtros</Link>
            </>
          ) : (
            <p className="font-medium">Nenhum carrinho ainda. Os carrinhos abandonados da loja aparecem aqui.</p>
          )}
        </div>
      ) : (
        <>
          <CartTable rows={rows} timeZone={timeZone} />
          <nav aria-label="Paginação" className="flex items-center justify-between gap-2">
            {filters.page > 1 ? (
              <Link href={cartsHref(filters, { page: filters.page - 1 })} className={buttonVariants({ variant: "outline" })}>Anterior</Link>
            ) : <span aria-disabled="true" className={disabled}>Anterior</span>}
            <span className="text-sm text-muted-foreground">Página {filters.page} de {totalPages}</span>
            {filters.page < totalPages ? (
              <Link href={cartsHref(filters, { page: filters.page + 1 })} className={buttonVariants({ variant: "outline" })}>Próxima</Link>
            ) : <span aria-disabled="true" className={disabled}>Próxima</span>}
          </nav>
        </>
      )}
    </div>
  );
}

export default function CartsPage(props: Props) {
  return (
    <RequireOrg>
      <main className="space-y-2 p-6">
        <h1 className="text-2xl font-semibold">Carrinhos</h1>
        <Suspense fallback={<CartsSkeleton />}>
          <CartsContent {...props} />
        </Suspense>
      </main>
    </RequireOrg>
  );
}
