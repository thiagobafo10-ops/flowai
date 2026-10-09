import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export function GettingStartedBanner() {
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-primary/10 p-4 ring-1 ring-primary/20 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm">
        Ainda não há dados. Conecte um canal para começar a receber conversas.
      </p>
      <Link href="/configuracoes" className={buttonVariants()}>
        Conectar canal
      </Link>
    </div>
  );
}
