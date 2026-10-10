"use client";

import { useEffect } from "react";

/** Marca <html data-hydrated="1"> após a hidratação (usado pelos testes e2e para saber quando o app responde). */
export function HydrationMarker() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "1";
  }, []);
  return null;
}
