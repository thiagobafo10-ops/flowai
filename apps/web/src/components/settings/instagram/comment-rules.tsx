"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveCommentRule, setCommentRuleActive } from "@/lib/instagram/actions";
import type { InstagramConnectionView, InstagramRuleView } from "@/lib/instagram/queries";

export function InstagramCommentRules({ connection, rules, onChanged }: { connection: InstagramConnectionView; rules: InstagramRuleView[]; onChanged: () => void }) {
  const [keyword, setKeyword] = useState(""); const [reply, setReply] = useState(""); const [mediaId, setMediaId] = useState("");
  const [scope, setScope] = useState("all"); const [editing, setEditing] = useState<InstagramRuleView | null>(null);
  const [pending, startTransition] = useTransition(); const [error, setError] = useState<string | null>(null);
  const prefix = connection.channelId;
  function reset() { setKeyword(""); setReply(""); setMediaId(""); setScope("all"); setEditing(null); }
  function save() { setError(null); startTransition(async () => { const result = await saveCommentRule({ ...(editing ? { id: editing.id } : {}), channelId: connection.channelId, keyword, replyText: reply, mediaId: scope === "all" ? null : mediaId, active: editing?.active ?? false }); if (!result.ok) setError(result.error); else { reset(); onChanged(); } }); }
  function toggle(rule: InstagramRuleView) { setError(null); startTransition(async () => { const result = await setCommentRuleActive(rule.id, !rule.active); if (!result.ok) setError(result.error); onChanged(); }); }
  return <section className="space-y-4 rounded-lg border p-4" aria-busy={pending}>
    <div><h3 className="font-medium">Comentários → Direct</h3><p className="mt-1 text-sm text-muted-foreground">Responda uma vez no Direct quando um comentário contiver a palavra-chave completa. Se várias regras corresponderem, a mais antiga ativa tem prioridade. Ativar uma regra não responde a comentários antigos.</p></div>
    {rules.map((rule) => <article key={rule.id} data-testid="instagram-rule" className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{rule.keyword}</p><span className="text-xs">{rule.active ? "Ativa" : "Desativada"}</span></div>
      <p className="whitespace-pre-wrap break-words text-sm">{rule.replyText}</p><p className="text-xs text-muted-foreground">{rule.mediaId ? `Post/Reel ${rule.mediaId}` : "Todos os posts e Reels"}</p>
      {rule.lastState && <p className="text-xs text-muted-foreground">Último resultado: {rule.lastState === "done" ? "resposta enviada" : rule.lastState === "pending" ? "aguardando processamento" : rule.lastState === "ignored" ? "comentário não elegível ou regra alterada" : rule.lastState === "uncertain" ? "envio sem confirmação" : "falha no processamento"}</p>}
      <div className="flex gap-2"><Button size="sm" variant="outline" disabled={pending || (!rule.active && connection.status !== "active")} onClick={() => toggle(rule)}>{rule.active ? "Desativar regra" : "Ativar regra"}</Button><Button size="sm" variant="ghost" disabled={pending} onClick={() => { setEditing(rule); setKeyword(rule.keyword); setReply(rule.replyText); setScope(rule.mediaId ? "post" : "all"); setMediaId(rule.mediaId ?? ""); }}>Editar regra</Button></div>
    </article>)}
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <h4 className="text-sm font-medium">{editing ? "Editar regra" : "Nova regra"}</h4>
      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label htmlFor={`${prefix}-keyword`}>Palavra-chave</Label><Input id={`${prefix}-keyword`} value={keyword} onChange={(event) => setKeyword(event.target.value)} required maxLength={100} disabled={pending} /></div><div className="space-y-1"><Label htmlFor={`${prefix}-scope`}>Aplicar regra em</Label><select id={`${prefix}-scope`} value={scope} onChange={(event) => setScope(event.target.value)} disabled={pending} className="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="all">Todos os posts e Reels</option><option value="post">Um post ou Reel</option></select></div></div>
      {scope === "post" && <div className="space-y-1"><Label htmlFor={`${prefix}-media`}>ID do post ou Reel</Label><Input id={`${prefix}-media`} value={mediaId} onChange={(event) => setMediaId(event.target.value)} required inputMode="numeric" disabled={pending} /><p className="text-xs text-muted-foreground">A propriedade do post será conferida antes de salvar.</p></div>}
      <div className="space-y-1"><Label htmlFor={`${prefix}-reply`}>Resposta no Direct</Label><textarea id={`${prefix}-reply`} rows={3} value={reply} onChange={(event) => setReply(event.target.value)} required disabled={pending} className="w-full rounded-md border bg-transparent p-3 text-sm" /><p className="text-xs text-muted-foreground">Até 1.000 bytes. Uma nova regra fica desativada até você ativá-la.</p></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar regra"}</Button>{editing && <Button type="button" variant="ghost" disabled={pending} onClick={reset}>Cancelar edição</Button>}</div>
    </form>
  </section>;
}
