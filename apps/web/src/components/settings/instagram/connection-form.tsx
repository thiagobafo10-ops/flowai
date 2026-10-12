"use client";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { saveInstagramConnection } from "@/lib/instagram/actions";
import type { InstagramConnectionView } from "@/lib/instagram/queries";

export function InstagramConnectionForm({ initial, onSaved, onCancel }: { initial?: InstagramConnectionView; onSaved: () => void; onCancel?: () => void }) {
  const [name, setName] = useState(initial?.name ?? "Instagram");
  const [appId, setAppId] = useState(initial?.appId ?? "");
  const [accountId, setAccountId] = useState(initial?.accountId ?? "");
  const [version, setVersion] = useState(initial?.apiVersion ?? "");
  const [appSecret, setAppSecret] = useState(""); const [accessToken, setAccessToken] = useState("");
  const [pending, startTransition] = useTransition(); const [error, setError] = useState<string | null>(null);
  const prefix = initial?.id ?? "new-instagram";
  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveInstagramConnection({ name, appId, accountId, apiVersion: version, appSecret, accessToken, ...(initial ? { connectionId: initial.id } : {}) });
      if (!result.ok) { setError(result.error); return; }
      setAppSecret(""); setAccessToken(""); onSaved();
    });
  }
  return <form className="space-y-4 rounded-lg border bg-muted/20 p-4" onSubmit={(event) => { event.preventDefault(); save(); }} aria-busy={pending}>
    <h3 className="font-medium">{initial ? "Atualizar credenciais" : "Conectar Instagram"}</h3>
    <p className="text-sm text-muted-foreground">Use uma conta profissional e um app Meta com Instagram Login. O app deve ter as permissões de mensagens e comentários.</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor={`${prefix}-name`}>Nome do canal Instagram</Label><Input id={`${prefix}-name`} value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} disabled={pending} /></div>
      <div className="space-y-1"><Label htmlFor={`${prefix}-app`}>ID do app Meta</Label><Input id={`${prefix}-app`} value={appId} onChange={(e) => setAppId(e.target.value)} inputMode="numeric" required readOnly={!!initial} disabled={pending} /></div>
      <div className="space-y-1"><Label htmlFor={`${prefix}-account`}>ID da conta profissional</Label><Input id={`${prefix}-account`} value={accountId} onChange={(e) => setAccountId(e.target.value)} inputMode="numeric" required readOnly={!!initial} disabled={pending} /></div>
      <div className="space-y-1"><Label htmlFor={`${prefix}-version`}>Versão da Graph API</Label><Input id={`${prefix}-version`} value={version} onChange={(e) => setVersion(e.target.value)} placeholder="Ex.: v26.0" required disabled={pending} /></div>
      <div className="space-y-1"><Label htmlFor={`${prefix}-secret`}>App Secret</Label><Input id={`${prefix}-secret`} type="password" autoComplete="new-password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} required disabled={pending} /><p className="text-xs text-muted-foreground">Chave secreta do app que assina os webhooks.</p></div>
      <div className="space-y-1"><Label htmlFor={`${prefix}-token`}>Access Token</Label><Input id={`${prefix}-token`} type="password" autoComplete="new-password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} required disabled={pending} /><p className="text-xs text-muted-foreground">Token da conta profissional. Não será exibido depois de salvar.</p></div>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar conexão Instagram"}</Button>{onCancel && <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>Cancelar</Button>}</div>
  </form>;
}
