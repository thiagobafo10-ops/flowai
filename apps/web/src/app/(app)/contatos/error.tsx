"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ContactsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <p role="alert" className="text-sm text-muted-foreground">
        Não foi possível carregar os contatos.
      </p>
      <Button type="button" variant="outline" onClick={() => retry()}>
        Tentar novamente
      </Button>
    </main>
  );
}
