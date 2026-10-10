import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function ContactNotFound() {
  return (
    <main className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="font-medium">Contato não encontrado</p>
      <Link href="/contatos" className={buttonVariants({ variant: "outline" })}>
        Voltar para contatos
      </Link>
    </main>
  );
}
