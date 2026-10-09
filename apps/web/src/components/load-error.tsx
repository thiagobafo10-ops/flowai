"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

type Props = { error: Error & { digest?: string }; retry: () => void };

/** Fallback de error boundary: falha ao carregar dados (ex.: erro transitório do banco). */
export function LoadError({ error, retry }: Props) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <p role="alert" className="text-sm text-muted-foreground">
        Não foi possível carregar seus dados.
      </p>
      <Button type="button" variant="outline" onClick={() => retry()}>
        Tentar novamente
      </Button>
    </main>
  );
}
