import Link from "next/link";

/** As regras de comentário viraram automações (gatilho "Comentário no Instagram"). */
export function InstagramCommentRules() {
  return <section data-testid="instagram-rules-moved" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4 text-sm">
    <p>As regras de comentário agora são automações.</p>
    <Link href="/automacoes" className="font-medium text-primary underline-offset-4 hover:underline">Gerenciar em Automações</Link>
  </section>;
}
