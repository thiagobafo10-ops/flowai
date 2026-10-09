"use client";

import { LoadError } from "@/components/load-error";

// Erros nas páginas do app (abaixo do layout de (app)).
export default function AppError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <LoadError {...props} />;
}
