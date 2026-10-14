"use client";

import dynamic from "next/dynamic";

// O React Flow depende do DOM (medidas, ResizeObserver): o editor só é renderizado no navegador.
// `ssr: false` não é permitido em Server Components, por isso este carregador cliente.
export const AutomationEditorLoader = dynamic(() => import("./editor").then((m) => m.AutomationEditor), {
  ssr: false,
  loading: () => <div aria-busy="true" aria-label="Carregando editor" className="h-[calc(100dvh-3.5rem)] animate-pulse bg-muted/40" />,
});
