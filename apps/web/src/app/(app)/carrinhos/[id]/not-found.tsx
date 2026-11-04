import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function CartNotFound() {
  return (
    <main className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="font-medium">Carrinho não encontrado</p>
      <Link href="/carrinhos" className={buttonVariants({ variant: "outline" })}>
        Voltar para carrinhos
      </Link>
    </main>
  );
}
