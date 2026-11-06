"use client";
import { useMemo } from "react";
import { renderEmail, type EmailContent } from "@flowai/core";

const SAMPLE = {
  firstName: "Maria", name: "Maria Silva", total: 179.8, buttonUrl: "https://example.com/pedido", unsubscribeUrl: "https://example.com/sair",
  orderNumber: "1234", trackingCode: "BR123456789BR",
  items: [
    { name: "Produto de exemplo", variant: "Tamanho M", quantity: 1, price: 129.9, imageUrl: null },
    { name: "Outro produto", variant: null, quantity: 1, price: 49.9, imageUrl: null },
  ],
};

/** Prévia com dados de exemplo, no mesmo modelo que o worker envia. */
export function EmailPreview({ content, storeName }: { content: EmailContent; storeName: string }) {
  const { subject, html } = useMemo(() => renderEmail(content, { ...SAMPLE, storeName }), [content, storeName]);
  return (
    <div className="space-y-2">
      <p className="text-sm"><span className="text-muted-foreground">Assunto:</span> {subject}</p>
      {/* sandbox vazio: sem scripts, sem navegação, origem isolada. */}
      <iframe title="Prévia do e-mail" sandbox="" srcDoc={html} className="h-[480px] w-full rounded-lg border bg-white" />
    </div>
  );
}
