"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveInstagramVipSettings, verifyInstagramVipPermission } from "@/lib/instagram/actions";
import { VIP_GROUP_DEFAULT, VIP_PUBLIC_DEFAULT, vipPrivatePreview, vipErrorMessage, vipSaveInput } from "@/lib/instagram/vip";
import type { InstagramConnectionView } from "@/lib/instagram/queries";
export function InstagramVipCard({ connection, onChanged }: { connection: InstagramConnectionView; onChanged: () => void }) {
 const setting = connection.vip;
 const [text, setText] = useState(setting?.publicReplyText ?? VIP_PUBLIC_DEFAULT);
 const [url, setUrl] = useState(setting?.groupUrl ?? VIP_GROUP_DEFAULT);
 const [saved, setSaved] = useState({ publicReplyText: setting?.publicReplyText ?? VIP_PUBLIC_DEFAULT, groupUrl: setting?.groupUrl ?? VIP_GROUP_DEFAULT });
 const [enabled, setEnabled] = useState(setting?.enabled ?? false);
 const verified = !!setting?.commentsVerifiedAt && !setting.commentsError;
 const [feedback, setFeedback] = useState<string | null>(null);
 const [error, setError] = useState<string | null>(null);
 const [pending, startTransition] = useTransition();
 const connected = connection.status === "active" && !connection.disconnected;
 function save(active: boolean, pause = false) { setError(null); setFeedback(null); startTransition(async () => { const result = await saveInstagramVipSettings(vipSaveInput(connection.channelId, active, { publicReplyText: text, groupUrl: url }, saved, pause)); if (!result.ok) setError(result.error); else { setEnabled(active); if (!pause) setSaved({ publicReplyText: text, groupUrl: url }); setFeedback(active ? "VIP ativado." : "Configuração VIP salva desativada."); onChanged(); } }); }
 function verify() { setError(null); setFeedback(null); startTransition(async () => { const result = await verifyInstagramVipPermission(connection.channelId); if (!result.ok) setError(result.error); else setFeedback("Permissão de comentários verificada."); onChanged(); }); }
 return <section data-testid="instagram-vip" className="space-y-3 rounded-lg border p-4" aria-busy={pending}>
  <div className="flex items-center justify-between gap-2"><h3 className="font-medium">Convite público para o grupo VIP</h3><span className="text-sm">{enabled ? "VIP ativo" : "VIP desativado"}</span></div>
  <p className="text-sm text-muted-foreground">Todas as publicações. Somente novos comentários após a ativação, inclusive em posts antigos. Comentários anteriores não serão enviados.</p>
  <div className="space-y-1"><Label htmlFor={`${connection.channelId}-vip-text`}>Resposta pública VIP</Label><textarea id={`${connection.channelId}-vip-text`} className="min-h-24 w-full rounded-md border p-2 text-sm" value={text} onChange={event => setText(event.target.value)} disabled={pending} /></div>
  <div className="space-y-1"><Label htmlFor={`${connection.channelId}-vip-url`}>Link do grupo WhatsApp</Label><Input id={`${connection.channelId}-vip-url`} type="url" value={url} onChange={event => setUrl(event.target.value)} disabled={pending} /></div>
  <div className="space-y-2 rounded-md bg-muted p-3 text-sm"><p className="font-medium">Prévia pública · novos comentários</p><p className="whitespace-pre-wrap break-words">{text}</p><p className="font-medium">Prévia do Direct · comentários com a palavra VIP</p><p className="break-words">{vipPrivatePreview(url)}</p></div>
  <p className="text-sm text-muted-foreground">Verifique a permissão de comentários antes de ativar. Se faltar permissão, reconecte o Instagram. Envios com resultado incerto não são repetidos automaticamente.</p>
  <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={pending} onClick={() => save(false)}>Salvar desativado</Button><Button variant="outline" disabled={pending || !connected} onClick={verify}>Verificar permissão de comentários</Button>{enabled ? <Button disabled={pending} onClick={() => save(false, true)}>Pausar VIP</Button> : <Button disabled={pending || !connected || !verified} onClick={() => save(true)}>Ativar VIP</Button>}</div>
  {feedback && <p role="status" className="text-sm">{feedback}</p>}
  {(error || setting?.lastError || setting?.commentsError) && <p role="alert" className="text-sm text-destructive">{error ?? vipErrorMessage(setting?.lastError ?? setting?.commentsError)}</p>}
 </section>;
}
