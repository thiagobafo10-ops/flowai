"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { disconnectInstagramConnection, removeInstagramConnection, revealInstagramVerifyToken, testInstagramConnection } from "@/lib/instagram/actions";
import { instagramConnectionErrorMessage } from "@/lib/instagram/messages";
import type { InstagramConnectionView } from "@/lib/instagram/queries";
import type { ActionResult } from "@/lib/action-result";
export function InstagramConnectionCard({ connection, onChanged, onEdit }: { connection: InstagramConnectionView; onChanged: () => void; onEdit: () => void }) {
  const [token, setToken] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function run(action: () => Promise<ActionResult>) { setError(null); startTransition(async () => { const result = await action(); if (!result.ok) setError(result.error); onChanged(); }); }
  function reveal() { setError(null); startTransition(async () => { const result = await revealInstagramVerifyToken(connection.id); if (result.ok) setToken(result.data.token); else setError(result.error); }); }
  return <section data-testid="instagram-connection" className="space-y-3 rounded-lg border p-4" aria-busy={pending}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{connection.name}</h3><span className="rounded-full bg-muted px-2 py-1 text-xs">{connection.disconnected ? "Desconectado" : connection.status === "active" ? "Ativo" : connection.status === "error" ? "Precisa de atenção" : "Em configuração"}</span></div>
    <p className="text-xs text-muted-foreground break-all">Conta {connection.accountId} · App {connection.appId} · {connection.apiVersion}</p>
    <div className="flex flex-wrap gap-3 text-sm"><span>{connection.tokenVerified ? "Token verificado" : "Token pendente"}</span><span>{connection.webhookVerified ? "Webhook confirmado" : "Webhook pendente"}</span></div>
    <div className="space-y-1"><Label htmlFor={`${connection.id}-callback`}>URL do webhook</Label><Input id={`${connection.id}-callback`} readOnly value={connection.callbackUrl} className="font-mono text-xs" /></div>
    <p className="text-sm text-muted-foreground">No app Meta, configure esta URL e o verify token. Assine messages, comments, messaging_seen e messaging_postbacks. O teste da conexão habilita as notificações da conta.</p>
    {token !== null && <div className="space-y-1"><Label htmlFor={`${connection.id}-verify`}>Verify token</Label><Input id={`${connection.id}-verify`} value={token} readOnly className="font-mono text-xs" /></div>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={pending || connection.disconnected} onClick={() => run(() => testInstagramConnection(connection.id))}>Testar conexão Instagram</Button><Button variant="outline" disabled={pending || connection.disconnected} onClick={() => token === null ? reveal() : setToken(null)}>{token === null ? "Mostrar verify token" : "Ocultar verify token"}</Button><Button variant="ghost" disabled={pending} onClick={onEdit}>Atualizar credenciais</Button>{!connection.disconnected && <Button variant="ghost" disabled={pending} onClick={() => run(() => disconnectInstagramConnection(connection.id))}>Desconectar Instagram</Button>}{connection.disconnected && <Button variant="ghost" disabled={pending} onClick={() => run(() => removeInstagramConnection(connection.id))}>Remover conexão</Button>}</div>
    {connection.disconnected && <p className="text-xs text-muted-foreground">Remover apaga as credenciais. Conversas já recebidas continuam no Inbox.</p>}
    {(error || connection.lastError) && <p role="alert" className="text-sm text-destructive">{error ?? instagramConnectionErrorMessage(connection.lastError)}</p>}
  </section>;
}
