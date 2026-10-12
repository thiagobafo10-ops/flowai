"use client";

import { useRef, useState } from "react";
import { MAX_MESSAGE_LENGTH, replySchema } from "@flowai/core";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/** `replyBlocked`: motivo pelo qual respostas ao contato estão bloqueadas (notas internas continuam). */
export function Composer({ closed, busy, replyBlocked = null, onSend }: { closed: boolean; busy: boolean; replyBlocked?: string | null; onSend: (text: string, note: boolean, requestId: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [noteChosen, setNote] = useState(false);
  const note = noteChosen || replyBlocked !== null;
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const draftRequest = useRef<{ id: string; text: string; note: boolean } | null>(null);
  async function send() {
    if (closed || busy || sending.current) return;
    const result = replySchema.safeParse({ text });
    if (!result.success) { setError(result.error.issues[0]?.message ?? "Escreva uma mensagem."); return; }
    setError(null);
    if (!draftRequest.current || draftRequest.current.text !== result.data.text || draftRequest.current.note !== note) draftRequest.current = { id: crypto.randomUUID(), text: result.data.text, note };
    sending.current = true;
    try { if (await onSend(result.data.text, note, draftRequest.current.id)) { setText(""); draftRequest.current = null; } }
    finally { sending.current = false; }
  }
  return (
    <form className="space-y-2 border-t p-4" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <div className="flex gap-1"><Button type="button" size="sm" variant={note ? "ghost" : "secondary"} aria-pressed={!note} disabled={closed || busy || replyBlocked !== null} onClick={() => setNote(false)}>Responder</Button><Button type="button" size="sm" variant={note ? "secondary" : "ghost"} aria-pressed={note} disabled={closed || busy} onClick={() => setNote(true)}>Nota interna</Button></div>
      {closed && <p className="text-sm text-muted-foreground">Reabra a conversa para responder.</p>}
      {!closed && replyBlocked && <p role="status" className="text-sm text-muted-foreground">{replyBlocked}</p>}
      <Label htmlFor="inbox-message" className="sr-only">Escreva sua mensagem</Label>
      <textarea id="inbox-message" rows={3} value={text} disabled={closed || busy} aria-invalid={!!error}
        aria-describedby={error ? "inbox-message-error" : undefined} placeholder={note ? "Escreva uma nota interna…" : "Escreva sua mensagem…"}
        className="w-full resize-none rounded-lg border border-input bg-transparent p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        onChange={(event) => { setText(event.target.value); setError(null); }}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
      {error && <p id="inbox-message-error" role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center justify-end gap-3">{text.length >= 3900 && <span className={text.length > MAX_MESSAGE_LENGTH ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{text.length}/{MAX_MESSAGE_LENGTH}</span>}<Button type="submit" disabled={closed || busy}>{busy ? "Enviando…" : "Enviar"}</Button></div>
    </form>
  );
}
