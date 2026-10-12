import Link from "next/link";
import { CHANNEL_TYPE_LABELS } from "@flowai/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/crm/format";
import type { listContactConversations } from "@/lib/inbox/contact-queries";

type Props = { conversations: Awaited<ReturnType<typeof listContactConversations>>; timezone: string };
const STATUS_LABELS = { open: "Aberta", pending_human: "Aguardando humano", closed: "Fechada" };

export function ConversationsCard({ conversations, timezone }: Props) {
  return <Card role="region" aria-label="Conversas">
    <CardHeader><CardTitle>Conversas</CardTitle></CardHeader>
    <CardContent>
      {conversations.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma conversa ainda.</p> :
        <ul className="space-y-3">{conversations.map((conversation) => <li key={conversation.id}>
          <Link href={`/inbox?c=${conversation.id}`} className="block space-y-1 rounded-md border p-3 hover:bg-accent">
            <span className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium">{conversation.channelType ? CHANNEL_TYPE_LABELS[conversation.channelType] : "Canal removido"}</span><span>{STATUS_LABELS[conversation.status]}</span></span>
            <p className="truncate text-sm">{conversation.preview ?? "Sem mensagens."}</p>
            <p className="text-xs text-muted-foreground">{formatDateTime(conversation.lastMessageAt, timezone)}</p>
          </Link>
        </li>)}</ul>}
    </CardContent>
  </Card>;
}
