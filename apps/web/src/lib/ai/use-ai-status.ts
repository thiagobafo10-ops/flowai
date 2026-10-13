"use client";

import { useQuery } from "@tanstack/react-query";
import { getAiStatus } from "./actions";

/** Situação da chave da IA na plataforma (compartilhada entre /ia e /conhecimento). */
export function useAiStatus(orgId: string) {
  return useQuery({
    queryKey: ["ai-status", orgId],
    queryFn: async () => {
      const result = await getAiStatus();
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    staleTime: 60_000,
  });
}
