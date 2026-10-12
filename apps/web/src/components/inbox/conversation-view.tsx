"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { formatDaySeparator } from "@flowai/core";
import type { getConversation, MessageItem } from "@/lib/inbox/queries";
import type { MemberOption } from "@/lib/crm/queries";
import type { ActionResult } from "@/lib/action-result";
import { addInternalNote, assignConversation, closeConversation, reopenConversation, retryMessage, sendReply, takeOver } from "@/lib/inbox/actions";
import { Button } from "@/components/ui/button";
import { ConversationHeader } from "./conversation-header";
import { MessageBubble } from "./message-bubble";
import { Composer } from "./composer";
import { TransferDialog } from "./transfer-dialog";

export type ConversationPage = NonNullable<Awaited<ReturnType<typeof getConversation>>>;
export function ConversationView({ data, userId, members, canWrite, busy, now, timezone, onAction, onBack, onContact }: {
  data: ConversationPage; userId: string; members: MemberOption[]; canWrite: boolean; busy: boolean; now: string; timezone: string;
  onAction: (action: () => Promise<ActionResult<unknown>>) => Promise<boolean>; onBack: () => void; onContact: () => void;
}) {
  const [transfer, setTransfer] = useState(false);
  const [older, setOlder] = useState<MessageItem[]>([]);
  // Keep the messages already shown when a fresh latest-page fetch displaces
  // its oldest item. Refreshed items win so delivery status stays current.
  const [retained, setRetained] = useState(data.messages);
  const [lastPage, setLastPage] = useState(data.messages);
  if (data.messages !== lastPage) {
    setLastPage(data.messages);
    setRetained((current) => [...new Map([...current, ...data.messages].map((message) => [message.id, message])).values()]);
  }
  const [olderRemaining, setOlderRemaining] = useState<boolean | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const prependHeight = useRef<number | null>(null);
  const messages = [...new Map([...older, ...retained, ...data.messages].map((message) => [message.id, message])).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const lastId = messages.at(-1)?.id;
  const [seenId, setSeenId] = useState(lastId);
  const { conversation } = data;
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    if (prependHeight.current !== null) { element.scrollTop += element.scrollHeight - prependHeight.current; prependHeight.current = null; }
    else if (atBottom) element.scrollTop = element.scrollHeight;
  }, [data.messages, older, atBottom]);
  async function loadOlder() {
    const first = messages[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true); setHistoryError(false);
    try {
      const response = await fetch(`/api/inbox/${conversation.id}?antes=${encodeURIComponent(`${first.createdAt}|${first.id}`)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível carregar mensagens.");
      const page = await response.json() as ConversationPage;
      prependHeight.current = scroll.current?.scrollHeight ?? null;
      setOlder((current) => [...page.messages, ...current]); setOlderRemaining(page.hasMore);
    } catch { setHistoryError(true); }
    finally { setLoadingOlder(false); }
  }
  return <section role="region" aria-label="Conversa" aria-busy={busy || loadingOlder} className="flex h-full min-h-0 min-w-0 flex-col">
    <ConversationHeader conversation={conversation} userId={userId} canWrite={canWrite} busy={busy} onBack={onBack} onContact={onContact} onTakeOver={() => { void onAction(() => takeOver(conversation.id)); }} onTransfer={() => setTransfer(true)} onClose={() => { void onAction(() => closeConversation(conversation.id)); }} onReopen={() => { void onAction(() => reopenConversation(conversation.id)); }} />
    <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto p-4" onScroll={() => {
      const element = scroll.current;
      if (!element) return;
      const nextAtBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
      // Leaving the bottom has already exposed the latest message. Once the
      // reader is above it, incoming messages remain unseen until they return.
      if (atBottom || nextAtBottom) setSeenId(lastId);
      setAtBottom(nextAtBottom);
    }}>
      {(olderRemaining ?? data.hasMore) && <div className="mb-4 text-center"><Button variant="outline" disabled={loadingOlder} onClick={() => { void loadOlder(); }}>Ver anteriores</Button></div>}
      {historyError && <p role="alert" className="mb-3 text-center text-sm text-destructive">Não foi possível carregar mensagens. Tente novamente.</p>}
      <div role="log" aria-label="Histórico de mensagens" aria-live="polite" className="space-y-3">{messages.map((message, index) => {
        const day = formatDaySeparator(message.createdAt, new Date(now), timezone);
        const previousDay = index > 0 ? formatDaySeparator(messages[index - 1]!.createdAt, new Date(now), timezone) : null;
        return <Fragment key={message.id}>{day !== previousDay && <p className="py-2 text-center text-xs text-muted-foreground">{day}</p>}<MessageBubble message={message} userId={userId} timezone={timezone} canWrite={canWrite} busy={busy} onRetry={(id) => { void onAction(() => retryMessage(id)); }} /></Fragment>;
      })}</div>
    </div>
    {!atBottom && lastId !== seenId && <div className="flex justify-center pb-2"><Button size="sm" variant="secondary" onClick={() => { setAtBottom(true); if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; setSeenId(lastId); }}>Novas mensagens ↓</Button></div>}
    {canWrite && <Composer closed={conversation.status === "closed"} busy={busy} onSend={(text, note) => onAction(() => note ? addInternalNote(conversation.id, text) : sendReply(conversation.id, text))} />}
    {transfer && <TransferDialog open={transfer} onOpenChange={setTransfer} members={members} assignedTo={conversation.assignedTo?.userId ?? null} busy={busy} onTransfer={(id, note) => onAction(() => assignConversation(conversation.id, id, note))} />}
  </section>;
}
