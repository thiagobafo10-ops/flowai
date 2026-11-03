"use client";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/action-result";
import { saveSettings, saveStoreConnection, setCartJourneyEnabled, verifyDomain } from "@/lib/emails/actions";
import type { EmailsView } from "@/lib/emails/queries";
import { JourneyResults } from "./journey-results";
import { JourneyStepForm } from "./journey-step-form";
import { SendHistory } from "./send-history";

const DOMAIN: Record<string, string> = { verified: "Verificado", pending: "Pendente", failed: "Falhou", not_found: "Não encontrado no Resend" };

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(fn: () => Promise<ActionResult<unknown>>, success: string, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) { setError(result.error); return; }
      toast.success(success);
      after?.();
      router.refresh();
    });
  }
  return { pending, error, run };
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-4 rounded-lg border p-4">
      <h2 id={id} className="text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Alert({ error }: { error: string | null }) {
  return error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null;
}

function CopyField({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input id={id} readOnly value={value} className="font-mono text-xs" />
        <Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(value).then(() => toast.success("Copiado."), () => toast.error("Não foi possível copiar."))}>Copiar</Button>
      </div>
    </div>
  );
}

function StoreForm({ store, yampiUrl }: { store: EmailsView["store"]; yampiUrl: string | null }) {
  const [alias, setAlias] = useState(store?.alias ?? "");
  const [secret, setSecret] = useState("");
  const { pending, error, run } = useRun();
  return (
    <form aria-busy={pending} className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => saveStoreConnection({ alias, secret }), "Loja salva.", () => setSecret("")); }}>
      <h3 className="font-medium">Loja Yampi {store && <span className="text-sm font-normal text-muted-foreground">· conectada</span>}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="yampi-alias">Alias da loja</Label><Input id="yampi-alias" value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={200} required disabled={pending} /></div>
        <div className="space-y-1">
          <Label htmlFor="yampi-secret">Segredo do webhook Yampi</Label>
          <Input id="yampi-secret" type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} required disabled={pending} placeholder={store ? "Configurado — informe para salvar" : ""} />
        </div>
      </div>
      {yampiUrl ? <CopyField id="yampi-url" label="URL do webhook Yampi" value={yampiUrl} /> : <p className="text-sm text-muted-foreground">Salve a loja para ver a URL do webhook.</p>}
      <Alert error={error} />
      <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar loja"}</Button>
    </form>
  );
}

function SenderForm({ settings, resendUrl }: { settings: EmailsView["settings"]; resendUrl: string }) {
  const [fromName, setFromName] = useState(settings?.fromName ?? "");
  const [fromEmail, setFromEmail] = useState(settings?.fromEmail ?? "");
  const [replyTo, setReplyTo] = useState(settings?.replyTo ?? "");
  const [resendKey, setResendKey] = useState("");
  const [resendWebhookSecret, setResendWebhookSecret] = useState("");
  const { pending, error, run } = useRun();
  const verify = useRun();
  const configured = settings ? "Configurada — deixe vazio para manter" : "";
  return (
    <form aria-busy={pending} className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      run(() => saveSettings({ fromName, fromEmail, replyTo, resendKey, resendWebhookSecret }), "Remetente salvo.", () => { setResendKey(""); setResendWebhookSecret(""); });
    }}>
      <h3 className="font-medium">Remetente (Resend)</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="from-name">Nome do remetente</Label><Input id="from-name" value={fromName} onChange={(e) => setFromName(e.target.value)} maxLength={100} required disabled={pending} /></div>
        <div className="space-y-1"><Label htmlFor="from-email">E-mail do remetente</Label><Input id="from-email" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} required disabled={pending} /></div>
        <div className="space-y-1"><Label htmlFor="reply-to">Responder para (opcional)</Label><Input id="reply-to" type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} disabled={pending} /></div>
        <div className="space-y-1"><Label htmlFor="resend-key">Chave da API do Resend</Label><Input id="resend-key" type="password" autoComplete="new-password" value={resendKey} onChange={(e) => setResendKey(e.target.value)} required={!settings} placeholder={configured} disabled={pending} /></div>
        <div className="space-y-1"><Label htmlFor="resend-secret">Segredo do webhook do Resend</Label><Input id="resend-secret" type="password" autoComplete="new-password" value={resendWebhookSecret} onChange={(e) => setResendWebhookSecret(e.target.value)} required={!settings} placeholder={configured} disabled={pending} /></div>
      </div>
      <CopyField id="resend-url" label="URL do webhook do Resend" value={resendUrl} />
      <Alert error={error} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar remetente"}</Button>
        {settings && (
          <>
            <span className="text-sm text-muted-foreground">Domínio: {DOMAIN[settings.domainStatus ?? ""] ?? "Não verificado"}</span>
            <Button type="button" variant="outline" disabled={verify.pending} onClick={() => verify.run(verifyDomain, "Domínio consultado.")}>Verificar</Button>
          </>
        )}
      </div>
      <Alert error={verify.error} />
    </form>
  );
}

function CartJourney({ journey, storeName }: { journey: EmailsView["journey"]; storeName: string }) {
  const { pending, error, run } = useRun();
  const enabled = journey?.enabled ?? false;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">{enabled ? "Ligada" : "Desligada"}</span>
        <Button variant={enabled ? "outline" : "default"} disabled={pending} onClick={() => run(() => setCartJourneyEnabled(!enabled), enabled ? "Jornada desligada." : "Jornada ligada.")}>
          {enabled ? "Desligar" : "Ligar"}
        </Button>
      </div>
      <Alert error={error} />
      {journey?.steps.map((step) => <JourneyStepForm key={step.id} step={step} storeName={storeName} />)}
    </>
  );
}

export function EmailsSettings({ view }: { view: EmailsView }) {
  const storeName = view.settings?.fromName || "Sua loja";
  return (
    <div className="space-y-6">
      <Section id="emails-config" title="Configuração">
        <SenderForm settings={view.settings} resendUrl={view.webhooks.resend} />
        <hr />
        <StoreForm store={view.store} yampiUrl={view.webhooks.yampi} />
      </Section>
      <Section id="emails-cart" title="Carrinho abandonado">
        <CartJourney journey={view.journey} storeName={storeName} />
      </Section>
      <Section id="emails-results" title="Resultados (últimos 30 dias)">
        <JourneyResults results={view.results} />
      </Section>
      <Section id="emails-history" title="Histórico">
        <SendHistory sends={view.sends} />
      </Section>
    </div>
  );
}
