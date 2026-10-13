"use client";

import { CHANNEL_TYPE_LABELS, contactDisplayName } from "@flowai/core";
import type { ConversationDetail } from "@/lib/inbox/queries";
import { Button } from "@/components/ui/button";

export const CONVERSATION_STATUS = { open: "Aberta", pending_human: "Aguardando humano", closed: "Fechada" };

export function ConversationHeader({ conversation, userId, canWrite, busy, onBack, onContact, onTakeOver, onReturnToAi, onTransfer, onClose, onReopen }: {
  conversation: ConversationDetail; userId: string; canWrite: boolean; busy: boolean;
  onBack: () => void; onContact: () => void; onTakeOver: () => void; onReturnToAi: () => void; onTransfer: () => void; onClose: () => void; onReopen: () => void;
}) {
  return <header className="space-y-3 border-b p-4">
    <div className="flex items-center gap-2"><Button className="md:hidden" variant="ghost" size="sm" onClick={onBack}>Voltar</Button><div className="min-w-0 flex-1"><h2 className="truncate font-semibold">{contactDisplayName(conversation.contact)}</h2><p className="text-xs text-muted-foreground">{conversation.assignedTo?.name ?? "Sem responsável"}</p></div><Button variant="outline" size="sm" onClick={onContact}>Contato</Button></div>
    <div className="flex flex-wrap items-center gap-2"><span className="rounded border px-2 py-0.5 text-xs">{CHANNEL_TYPE_LABELS[conversation.channel.type]}</span><span className="text-xs text-muted-foreground">{CONVERSATION_STATUS[conversation.status]}</span>
      {canWrite && <div className="ml-auto flex flex-wrap gap-1">{conversation.status !== "closed" ? <>{conversation.assignedTo?.userId !== userId && <Button size="sm" variant="outline" disabled={busy} onClick={onTakeOver}>Assumir</Button>}{conversation.handledBy === "human" && <Button size="sm" variant="outline" disabled={busy} onClick={onReturnToAi}>Devolver para IA</Button>}<Button size="sm" variant="outline" disabled={busy} onClick={onTransfer}>Transferir</Button><Button size="sm" variant="outline" disabled={busy} onClick={onClose}>Fechar</Button></> : <Button size="sm" variant="outline" disabled={busy} onClick={onReopen}>Reabrir</Button>}</div>}
    </div>
  </header>;
}
