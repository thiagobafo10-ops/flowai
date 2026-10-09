"use client";

import { LoadError } from "@/components/load-error";

// Erros no layout de (app) e no onboarding: um error.tsx não envolve o layout
// do próprio segmento, então o fallback raiz cobre AppShell e OnboardingGate.
export default function RootError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <LoadError {...props} />;
}
