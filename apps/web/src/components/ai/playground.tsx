"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { HANDOFF_LABELS } from "@flowai/core";
import { runPlayground } from "@/lib/ai/actions";
import type { PlaygroundMessage, PlaygroundResult } from "@/lib/ai/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAX_MESSAGES = 10;
const SENTIMENT: Record<string, string> = { positive: "positivo", neutral: "neutro", negative: "negativo" };

type Entry = PlaygroundMessage & { details?: PlaygroundResult };

function handoffLabel(d: PlaygroundResult["decision"]): string {
  if (d.label) return d.label;
  const known = d.reason ? (HANDOFF_LABELS as Record<string, string>)[d.reason] : undefined;
  return known ?? d.reason ?? "";
}

function Details({ result }: { result: PlaygroundResult }) {
  const c = result.classification;
  return (
    <details className="mt-1 text-xs text-muted-foreground">
      <summary className="cursor-pointer">Detalhes da resposta</summary>
      <div className="mt-1 space-y-1">
        {c && <p>Intenção: {c.intent} · Sentimento: {SENTIMENT[c.sentiment] ?? c.sentiment} · Lead score: {c.lead_score}</p>}
        <div>
          <p className="font-medium">Trechos usados</p>
          {result.hits.length === 0 ? <p>Nenhum trecho.</p> : (
            <ul className="list-disc pl-4">
              {result.hits.map((h) => <li key={h.id}>{h.documentTitle} ({Math.round(h.similarity * 100)}%)</li>)}
            </ul>
          )}
        </div>
        <p><span className="font-medium">Verificação de valores:</span> {result.factCheck.ok ? "ok" : `não confirmados: ${result.factCheck.unverified.join(", ")}`}</p>
        {result.decision.handoff && <p className="font-medium">Transferiria para humano: {handoffLabel(result.decision)}</p>}
      </div>
    </details>
  );
}

export function Playground({ orgId, canTest }: { orgId: string; canTest: boolean }) {
  const client = useQueryClient();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const full = entries.length >= MAX_MESSAGES;

  if (!canTest) {
    return (
      <section aria-labelledby="ai-playground-title" className="space-y-2 rounded-xl border p-4">
        <h2 id="ai-playground-title" className="font-medium">Área de teste</h2>
        <p role="status" className="text-sm text-muted-foreground">Somente administradores podem testar o agente.</p>
      </section>
    );
  }

  function send() {
    const message = text.trim();
    if (!message || full || pending) return;
    setError(null);
    const history: Entry[] = [...entries, { role: "contact", text: message }];
    setEntries(history);
    setText("");
    startTransition(async () => {
      const result = await runPlayground(history.map(({ role, text: t }) => ({ role, text: t })));
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        setEntries(entries);
        setText(message);
        return;
      }
      setEntries([...history, { role: "ai", text: result.data.reply, details: result.data }]);
      void client.invalidateQueries({ queryKey: ["ai-agent", orgId] });
    });
  }

  return (
    <section aria-labelledby="ai-playground-title" className="space-y-3 rounded-xl border p-4">
      <h2 id="ai-playground-title" className="font-medium">Área de teste</h2>
      <ul aria-live="polite" className="space-y-2">
        {entries.map((e, i) => (
          <li key={i} className={e.role === "contact" ? "text-sm" : "rounded-lg bg-muted p-2 text-sm"}>
            <span className="font-medium">{e.role === "contact" ? "Contato" : "IA"}:</span> {e.text}
            {e.details && <Details result={e.details} />}
          </li>
        ))}
      </ul>
      {full && <p role="status" className="text-sm text-amber-600">Limite de {MAX_MESSAGES} mensagens atingido. Limpe a conversa para continuar.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <Label htmlFor="playground-message">Mensagem do contato</Label>
        <div className="flex gap-2">
          <Input id="playground-message" value={text} maxLength={1000} autoComplete="off" disabled={full || pending} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" disabled={full || pending || !text.trim()}>
            {pending && <Loader2Icon className="animate-spin" />}
            Enviar
          </Button>
          <Button type="button" variant="outline" disabled={pending || entries.length === 0} onClick={() => { setEntries([]); setError(null); }}>Limpar</Button>
        </div>
      </form>
    </section>
  );
}
