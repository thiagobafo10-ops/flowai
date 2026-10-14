"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CONTACT_STATUS_LABELS, contactDisplayName, formatBRL, formatBrazilianPhone } from "@flowai/core";
import { toast } from "sonner";
import { TagsCard } from "@/components/crm/contact-detail/tags-card";
import { ContactSequencesSection } from "@/components/growth/contact-sequences-section";
import { DealDialog, type DealDialogState } from "@/components/crm/deal-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { moveDeal } from "@/lib/crm/deal-actions";
import { updateContactLeadScore } from "@/lib/inbox/contact-actions";
import { sentimentLabel } from "@/lib/inbox/ai-display";
import type { ContactPanelData } from "@/lib/inbox/contact-queries";

type Props = { orgId: string; contactId: string; conversationId: string; canEdit: boolean; canDelete?: boolean; onClose?: () => void };

export function ContactPanel(props: Props) {
  const query = useQuery<ContactPanelData>({
    queryKey: ["inbox-contact", props.orgId, props.contactId, props.conversationId],
    queryFn: async () => {
      const response = await fetch(`/api/inbox/contact/${props.contactId}?c=${props.conversationId}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível carregar o contato.");
      return response.json();
    },
  });
  return <section role="region" aria-label="Contato da conversa" aria-busy={query.isFetching} className="h-full overflow-y-auto p-4">
    {props.onClose && <Button variant="ghost" size="sm" onClick={props.onClose}>Ocultar contato</Button>}
    {query.isPending ? <p role="status">Carregando contato…</p> : query.isError ? <div><p role="alert">Não foi possível carregar o contato.</p><Button variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button></div> :
      <ContactPanelContent key={props.contactId} {...props} data={query.data} />}
  </section>;
}

function ContactPanelContent({ orgId, contactId, conversationId, canEdit, canDelete = false, data }: Props & { data: ContactPanelData }) {
  const router = useRouter();
  const client = useQueryClient();
  const [dialog, setDialog] = useState<DealDialogState | null>(null);
  const [pending, startTransition] = useTransition();
  const [score, setScore] = useState(String(data.contact.leadScore));
  const [seenScore, setSeenScore] = useState(data.contact.leadScore);
  const [scoreDirty, setScoreDirty] = useState(false);
  // Realtime pode atualizar a ficha sem trocar o contato. Preserve texto em edição.
  if (seenScore !== data.contact.leadScore) {
    setSeenScore(data.contact.leadScore);
    if (!scoreDirty) setScore(String(data.contact.leadScore));
  }
  const [error, setError] = useState<string | null>(null);
  const name = contactDisplayName(data.contact);
  const stage = data.stages.find((s) => s.id === data.deal?.stageId);
  function refresh() {
    void client.invalidateQueries({ queryKey: ["inbox-contact", orgId, contactId] });
    void client.invalidateQueries({ queryKey: ["inbox", orgId] });
    void client.invalidateQueries({ queryKey: ["conversation", orgId, conversationId] });
    router.refresh();
  }
  function saveScore() {
    setError(null);
    startTransition(async () => {
      const result = await updateContactLeadScore(contactId, score.trim() === "" ? NaN : Number(score));
      if (!result.ok) { setError(result.error); return; }
      setScore(String(Number(score)));
      setScoreDirty(false);
      toast.success("Lead score salvo.");
      refresh();
    });
  }
  function changeStage(stageId: string) {
    if (!data.deal) return;
    const id = data.deal.id;
    setError(null);
    startTransition(async () => {
      const result = await moveDeal(id, stageId);
      if (!result.ok) { setError(result.error); toast.error(result.error); }
      refresh();
    });
  }
  return <div className="space-y-4" aria-busy={pending}>
    <div className="space-y-1">
      <h2 className="text-lg font-semibold">{name}</h2>
      <p className="text-sm">{data.contact.phone ? formatBrazilianPhone(data.contact.phone) : "—"}</p>
      <p className="break-all text-sm">{data.contact.email ?? "—"}</p>
      <p className="text-sm text-muted-foreground">{CONTACT_STATUS_LABELS[data.contact.status]}</p>
      <Link href={`/contatos/${contactId}`} className="text-sm underline underline-offset-2">Ver ficha</Link>
    </div>
    <TagsCard contactId={contactId} tags={data.contact.tags} allTags={data.tags} canEdit={canEdit} onChanged={refresh} />
    <section className="space-y-2 rounded-lg border p-3">
      <h3 className="font-medium">Pipeline</h3>
      {data.deal ? <>
        <p className="text-sm">{data.deal.title}</p>
        <p className="text-sm">Etapa: {stage?.name ?? "etapa removida"}</p>
        <p className="text-sm">Valor: {formatBRL(data.deal.value)}</p>
        {canEdit && <><Label htmlFor={`stage-${contactId}`}>Mover etapa</Label><select id={`stage-${contactId}`} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={data.deal.stageId} disabled={pending} onChange={(e) => changeStage(e.target.value)}>{data.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></>}
      </> : <><p className="text-sm text-muted-foreground">Nenhum deal aberto.</p>{canEdit && data.stages[0] && <Button variant="outline" size="sm" onClick={() => setDialog({ mode: "create", stageId: data.stages[0].id, contact: { id: contactId, name } })}>Criar deal</Button>}</>}
    </section>
    <section className="space-y-3 rounded-lg border p-3">
      <h3 className="font-medium">IA</h3>
      <div className="space-y-2"><Label htmlFor={`score-${contactId}`}>Lead score</Label>{canEdit ? <><Input id={`score-${contactId}`} type="number" min={0} max={100} step={1} value={score} onChange={(e) => { setScore(e.target.value); setScoreDirty(e.target.value !== String(data.contact.leadScore)); }} disabled={pending} /><Button variant="outline" size="sm" disabled={pending} onClick={saveScore}>Salvar lead score</Button></> : <p className="text-sm">{data.contact.leadScore}</p>}</div>
      {([ ["Intenção", data.intelligence.intent], ["Sentimento", sentimentLabel(data.intelligence.sentiment)], ["Resumo da conversa", data.intelligence.summary] ] as const).map(([label, value]) => <div key={label}><p className="text-sm font-medium">{label}</p><p className="whitespace-pre-wrap text-sm text-muted-foreground">{value || "Aguardando IA"}</p></div>)}
    </section>
    <ContactSequencesSection orgId={orgId} contactId={contactId} canEdit={canEdit} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <DealDialog state={dialog} onClose={() => setDialog(null)} onChanged={refresh} stages={data.stages} members={data.members} canWrite={canEdit} canDelete={canDelete} />
  </div>;
}
