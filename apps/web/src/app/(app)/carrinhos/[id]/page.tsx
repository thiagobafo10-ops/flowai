import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CartDetailView } from "@/components/carts/cart-detail";
import { RequireOrg } from "@/components/require-org";
import { getCart } from "@/lib/carts/queries";
import { getOrgTimezone } from "@/lib/crm/queries";
import { getActiveOrg } from "@/lib/org/active-org";

type Props = { params: Promise<{ id: string }> };

async function CartContent({ params }: Props) {
  const { id } = await params;
  const org = await getActiveOrg();
  if (!org) return null;
  const [cart, timeZone] = await Promise.all([getCart(org.id, id), getOrgTimezone(org.id)]);
  if (!cart) notFound();
  return (
    <div className="space-y-4">
      <Link href="/carrinhos" className="text-sm text-muted-foreground underline underline-offset-2">Carrinhos</Link>
      <CartDetailView cart={cart} timeZone={timeZone} />
    </div>
  );
}

export default function CartPage(props: Props) {
  return (
    <RequireOrg>
      <main className="space-y-2 p-6">
        <h1 className="text-2xl font-semibold">Carrinho</h1>
        <Suspense fallback={<div aria-busy="true" aria-label="Carregando carrinho" className="h-40 animate-pulse rounded-lg bg-muted/60" />}>
          <CartContent {...props} />
        </Suspense>
      </main>
    </RequireOrg>
  );
}
