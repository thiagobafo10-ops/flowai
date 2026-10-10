"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function TagsError({
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
    <div className="flex flex-col items-center gap-4 p-6 text-center">
      <p role="alert" className="text-sm text-muted-foreground">
        Não foi possível carregar as tags.
      </p>
      <Button type="button" variant="outline" onClick={() => retry()}>
        Tentar novamente
      </Button>
    </div>
  );
}
