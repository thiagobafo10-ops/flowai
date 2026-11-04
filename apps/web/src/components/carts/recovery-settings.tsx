"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { renderWhatsappMessage } from "@flowai/core";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { saveRecoverySettings } from "@/lib/carts/actions";

const textarea = "w-full rounded-lg border border-input bg-transparent p-2 text-sm disabled:opacity-50";
const SAMPLE = { firstName: "Ana", link: "https://seguro.sualoja.com.br/carrinho/exemplo", total: 189.9,
  items: [{ name: "Vestido Linho", quantity: 1 }, { name: "Cinto Couro", quantity: 2 }] };

export function RecoverySettings({ template: initialTemplate, hosts: initialHosts, hasStore, storeName, checkoutConsent: initialConsent }:
  { template: string; hosts: string[]; hasStore: boolean; storeName: string; checkoutConsent: boolean }) {
  const router = useRouter();
  const [template, setTemplate] = useState(initialTemplate);
  const [hosts, setHosts] = useState(initialHosts.join("\n"));
  const [checkoutConsent, setCheckoutConsent] = useState(initialConsent);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form aria-busy={pending} className="space-y-6" onSubmit={(e) => {
      e.preventDefault();
      setError(null);
      startTransition(async () => {
        try {
          const r = await saveRecoverySettings(template, hosts, checkoutConsent);
          if (!r.ok) { setError(r.error); return; }
        } catch { setError("Falha de conexão. Tente novamente."); return; }
        toast.success("Configurações salvas.");
        router.refresh();
      });
    }}>
      <section aria-labelledby="wa-template" className="space-y-3 rounded-lg border p-4">
        <h2 id="wa-template" className="text-lg font-medium">Mensagem do WhatsApp</h2>
        <div className="space-y-1">
          <Label htmlFor="template">Modelo</Label>
          <textarea id="template" rows={6} maxLength={2000} className={textarea} value={template} onChange={(e) => setTemplate(e.target.value)} disabled={pending} />
          <p className="text-xs text-muted-foreground">Variáveis: {"{primeiro_nome}"}, {"{loja}"}, {"{valor}"}, {"{itens}"}, {"{link}"}.</p>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">Prévia (dados de exemplo)</p>
          <p className="whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-sm">{renderWhatsappMessage(template, { ...SAMPLE, storeName })}</p>
        </div>
        <div>
          <label htmlFor="checkout-consent" className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <input id="checkout-consent" type="checkbox" role="switch" className="size-4" checked={checkoutConsent}
              onChange={(e) => setCheckoutConsent(e.target.checked)} disabled={pending} />
            <span>Celular informado no checkout vale como autorização de WhatsApp</span>
          </label>
          <p className="text-xs text-muted-foreground mt-1 ml-6">Quem pediu para não receber ou foi bloqueado continua bloqueado.</p>
        </div>
      </section>
      <section aria-labelledby="checkout-hosts" className="space-y-3 rounded-lg border p-4">
        <h2 id="checkout-hosts" className="text-lg font-medium">Hosts de checkout autorizados</h2>
        <p className="text-sm text-muted-foreground">Um por linha. Só links de retomada nesses endereços entram na mensagem.</p>
        {!hasStore && <p className="text-sm text-muted-foreground">Conecte a loja Yampi em E-mails da loja para cadastrar hosts.</p>}
        <textarea id="hosts" aria-labelledby="checkout-hosts" rows={4} className={textarea} value={hosts} onChange={(e) => setHosts(e.target.value)} disabled={pending} placeholder="seguro.sualoja.com.br" />
      </section>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar"}</Button>
    </form>
  );
}
