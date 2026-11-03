"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveStep, sendTestEmail } from "@/lib/emails/actions";
import { fromMinutes, toMinutes, type DelayUnit } from "@/lib/emails/schemas";
import type { EmailStep } from "@/lib/emails/queries";
import { EmailPreview } from "./email-preview";

const textarea = "w-full rounded-lg border border-input bg-transparent p-2 text-sm disabled:opacity-50 aria-invalid:border-destructive";
const select = "h-8 rounded-lg border border-input bg-transparent px-2 text-sm disabled:opacity-50 dark:bg-input/30 [&>option]:bg-popover";

export function JourneyStepForm({ step, storeName }: { step: EmailStep; storeName: string }) {
  const router = useRouter();
  const initialDelay = fromMinutes(step.delayMinutes);
  const [delay, setDelay] = useState(String(initialDelay.value));
  const [unit, setUnit] = useState<DelayUnit>(initialDelay.unit);
  const [enabled, setEnabled] = useState(step.enabled);
  const [subject, setSubject] = useState(step.subject);
  const [heading, setHeading] = useState(step.heading);
  const [body, setBody] = useState(step.body);
  const [buttonLabel, setButtonLabel] = useState(step.buttonLabel);
  const [coupon, setCoupon] = useState(step.coupon);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = `step-${step.position}`;
  const couponMissing = [subject, heading, body].some((t) => t.includes("{cupom}")) && !coupon.trim();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveStep(step.id, { delayMinutes: toMinutes(Number(delay), unit), enabled, subject, heading, body, buttonLabel, coupon });
      if (!result.ok) { setError(result.error); return; }
      toast.success(`E-mail ${step.position} salvo.`);
      router.refresh();
    });
  }
  function test() {
    setError(null);
    startTransition(async () => {
      const result = await sendTestEmail(step.id);
      if (result.ok) toast.success("Teste enviado para o seu e-mail."); else setError(result.error);
    });
  }

  return (
    <form aria-labelledby={`${id}-title`} aria-busy={pending} className="grid gap-4 rounded-lg border p-4 lg:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`${id}-title`} className="font-medium">E-mail {step.position}</h3>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" role="switch" className="size-4" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={pending} />
            Ligado
          </label>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-delay`}>Enviar depois de</Label>
          <div className="flex gap-2">
            <Input id={`${id}-delay`} type="number" min={1} value={delay} onChange={(e) => setDelay(e.target.value)} className="w-24" disabled={pending} required />
            <select aria-label="Unidade da espera" className={select} value={unit} onChange={(e) => setUnit(e.target.value as DelayUnit)} disabled={pending}>
              <option value="min">minutos</option>
              <option value="h">horas</option>
              <option value="d">dias</option>
            </select>
          </div>
          <p className="text-xs text-muted-foreground">Contado a partir do abandono do carrinho.</p>
        </div>
        <div className="space-y-1"><Label htmlFor={`${id}-subject`}>Assunto</Label><Input id={`${id}-subject`} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} disabled={pending} required /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-heading`}>Título</Label><Input id={`${id}-heading`} value={heading} onChange={(e) => setHeading(e.target.value)} maxLength={150} disabled={pending} /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-body`}>Texto</Label><textarea id={`${id}-body`} rows={5} className={textarea} value={body} onChange={(e) => setBody(e.target.value)} maxLength={3000} disabled={pending} required /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor={`${id}-button`}>Texto do botão</Label><Input id={`${id}-button`} value={buttonLabel} onChange={(e) => setButtonLabel(e.target.value)} maxLength={40} disabled={pending} required /></div>
          <div className="space-y-1"><Label htmlFor={`${id}-coupon`}>Cupom</Label><Input id={`${id}-coupon`} value={coupon} onChange={(e) => setCoupon(e.target.value)} maxLength={40} disabled={pending} /></div>
        </div>
        <p className="text-xs text-muted-foreground">Variáveis: {"{primeiro_nome}"}, {"{nome}"}, {"{loja}"}, {"{cupom}"}, {"{valor}"}.</p>
        {couponMissing && <p role="status" className="text-sm text-amber-600 dark:text-amber-400">Este e-mail usa {"{cupom}"}, mas o cupom está vazio — ele não será enviado.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar"}</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={test}>Enviar teste para mim</Button>
        </div>
      </div>
      <EmailPreview content={{ subject, heading, body, buttonLabel, coupon: coupon.trim() || null }} storeName={storeName} />
    </form>
  );
}
