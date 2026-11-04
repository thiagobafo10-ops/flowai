"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";

/**
 * Uma request_key por intenção: criada no primeiro clique, reaproveitada ao repetir
 * depois de erro (inclusive de rede) e descartada só quando a ação dá certo.
 */
export function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());
  function run<T>(intent: string, fn: (key: string) => Promise<ActionResult<T>>, onOk?: (data: T) => void) {
    setError(null);
    let key = keys.current.get(intent);
    if (!key) { key = crypto.randomUUID(); keys.current.set(intent, key); }
    const k = key;
    startTransition(async () => {
      let result: ActionResult<T>;
      try { result = await fn(k); } catch { setError("Falha de conexão. Tente novamente."); return; }
      if (!result.ok) { setError(result.error); return; }
      keys.current.delete(intent);
      onOk?.(result.data);
      router.refresh();
    });
  }
  return { pending, error, setError, run };
}
