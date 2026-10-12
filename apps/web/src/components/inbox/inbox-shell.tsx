"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ChannelRow } from "@/lib/inbox/queries";
import type { MemberOption } from "@/lib/crm/queries";
import type { ActionResult } from "@/lib/action-result";
import { markRead } from "@/lib/inbox/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConversationList, type InboxFilters, type InboxPage } from "./conversation-list";
import { ConversationView, type ConversationPage } from "./conversation-view";
import { ContactPanel } from "./contact-panel";
import { SimulateDialog } from "./simulate-dialog";

async function fetchList(filters: InboxFilters, cursor?: string): Promise<InboxPage> {
  const params = new URLSearchParams({ aba: filters.tab });
  if (filters.q) params.set("q", filters.q);
  if (filters.channelId) params.set("canal", filters.channelId);
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/inbox?${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível carregar conversas.");
  return response.json();
}
export function InboxShell({ orgId, userId, filters, initialList, initialConversation, channels, members, canWrite, canAdmin, timezone, now }: {
  orgId: string; userId: string; filters: InboxFilters; initialList: InboxPage; initialConversation: ConversationPage | null;
  channels: ChannelRow[]; members: MemberOption[]; canWrite: boolean; canAdmin: boolean; timezone: string; now: string;
}) {
  const router = useRouter(); const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [loadingMore, setLoadingMore] = useState(false); const [simulate, setSimulate] = useState(false);
  const [showContact, setShowContact] = useState(true); const [contactOverlay, setContactOverlay] = useState(false);
  const listKey = useMemo(() => ["inbox", orgId, filters.tab, filters.q, filters.channelId] as const, [orgId, filters.tab, filters.q, filters.channelId]);
  const selectedId = initialConversation?.conversation.id ?? null;
  const detailKey = useMemo(() => ["conversation", orgId, selectedId] as const, [orgId, selectedId]);
  const list = useQuery({ queryKey: listKey, queryFn: () => fetchList(filters), initialData: initialList, staleTime: 30_000, retry: false });
  const detail = useQuery({ queryKey: detailKey, queryFn: async () => {
    const response = await fetch(`/api/inbox/${selectedId}`, { cache: "no-store" });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Não foi possível carregar a conversa.");
    return response.json() as Promise<ConversationPage>;
  }, enabled: !!selectedId, initialData: initialConversation, staleTime: 30_000, retry: false });
  useEffect(() => { queryClient.setQueryData(listKey, initialList); }, [queryClient, listKey, initialList]);
  useEffect(() => { queryClient.setQueryData(detailKey, initialConversation); }, [queryClient, detailKey, initialConversation]);
  const lastRead = useRef<string | null>(null);
  const latestInboundId = detail.data?.messages.findLast((message) => message.direction === "inbound" && !message.isInternalNote)?.id;
  useEffect(() => {
    if (!selectedId) return;
    const marker = `${selectedId}:${latestInboundId ?? ""}`;
    if (lastRead.current === marker) return;
    lastRead.current = marker;
    startTransition(async () => {
      const result = await markRead(selectedId);
      if (!result.ok) { toast.error(result.error); return; }
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["inbox", orgId] }), queryClient.invalidateQueries({ queryKey: ["unread", orgId] })]);
    });
  }, [selectedId, latestInboundId, queryClient, orgId]);
  function navigate(patch: Partial<InboxFilters>) {
    const next = { ...filters, ...patch }; const params = new URLSearchParams();
    if (next.tab !== "todas") params.set("aba", next.tab);
    if (next.conversationId) params.set("c", next.conversationId);
    if (next.q) params.set("q", next.q);
    if (next.channelId) params.set("canal", next.channelId);
    startTransition(() => router.push(`/inbox${params.size ? `?${params}` : ""}`, { scroll: false }));
  }
  function onAction(action: () => Promise<ActionResult<unknown>>): Promise<boolean> {
    return new Promise((resolve) => startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) { toast.error(result.error); resolve(false); return; }
        await Promise.all([queryClient.invalidateQueries({ queryKey: ["inbox", orgId] }), queryClient.invalidateQueries({ queryKey: ["conversation", orgId, selectedId] }), queryClient.invalidateQueries({ queryKey: ["unread", orgId] })]);
        resolve(true);
      } catch { toast.error("Não foi possível concluir. Tente novamente."); resolve(false); }
    }));
  }
  async function loadMore() {
    if (!list.data.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchList(filters, list.data.nextCursor);
      queryClient.setQueryData<InboxPage>(listKey, (old) => old ? { ...page, items: [...new Map([...old.items, ...page.items].map((item) => [item.id, item])).values()] } : page);
    } catch { toast.error("Não foi possível carregar conversas. Tente novamente."); }
    finally { setLoadingMore(false); }
  }
  const conversation = detail.data;
  const hasSimulator = channels.some((channel) => channel.type === "simulator" && channel.status === "active");
  return <main className="flex h-[calc(100dvh-3.5rem)] min-h-0 overflow-hidden">
    <div className={cn("flex w-full shrink-0 flex-col border-r md:flex md:w-80", conversation && "hidden")}>
      <ConversationList key={`${filters.tab}:${filters.q}:${filters.channelId}`} data={list.data} filters={{ ...filters, conversationId: selectedId }} channels={channels} hasSimulator={hasSimulator} canSimulate={canAdmin && hasSimulator} busy={pending || list.isFetching || loadingMore} now={now} timezone={timezone} onFilters={navigate} onSelect={(id) => navigate({ conversationId: id })} onMore={() => { void loadMore(); }} onSimulate={() => setSimulate(true)} />
      {list.isError && <div role="alert" className="p-4 text-sm text-destructive">Não foi possível carregar conversas.<Button variant="link" onClick={() => { void list.refetch(); }}>Tentar novamente</Button></div>}
    </div>
    <div className={cn("min-w-0 flex-1", !conversation && "hidden md:block")}>
      {conversation ? <ConversationView key={conversation.conversation.id} data={conversation} userId={userId} members={members} canWrite={canWrite} busy={pending || detail.isFetching} now={now} timezone={timezone} onAction={onAction} onBack={() => navigate({ conversationId: null })} onContact={() => { setContactOverlay(true); setShowContact(true); }} /> : <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">Selecione uma conversa</div>}
      {detail.isError && <div role="alert" className="p-4 text-sm text-destructive">Não foi possível carregar a conversa.<Button variant="link" onClick={() => { void detail.refetch(); }}>Tentar novamente</Button></div>}
    </div>
    {conversation && <>
      <aside className={cn("hidden w-80 shrink-0 overflow-y-auto border-l xl:block", !showContact && "xl:hidden")}>
        <Button variant="ghost" size="sm" className="m-3" onClick={() => setShowContact(false)}>Ocultar contato</Button>
        <ContactPanel key={conversation.conversation.id} orgId={orgId} contactId={conversation.conversation.contact.id} conversationId={conversation.conversation.id} canEdit={canWrite} canDelete={canAdmin} />
      </aside>
      {!showContact && <Button className="m-3 hidden xl:inline-flex" variant="outline" onClick={() => setShowContact(true)}>Mostrar contato</Button>}
      {contactOverlay && <div className="fixed inset-0 z-40 bg-background md:left-auto md:w-80 md:border-l xl:hidden"><div className="flex h-full min-h-0 flex-col"><Button className="m-3 self-start" variant="ghost" onClick={() => setContactOverlay(false)}>Voltar</Button><div className="min-h-0 flex-1 overflow-y-auto"><ContactPanel orgId={orgId} contactId={conversation.conversation.contact.id} conversationId={conversation.conversation.id} canEdit={canWrite} canDelete={canAdmin} onClose={() => setContactOverlay(false)} /></div></div></div>}
    </>}
    <SimulateDialog open={simulate} onOpenChange={setSimulate} onDone={(id) => { void queryClient.invalidateQueries({ queryKey: ["inbox", orgId] }); navigate({ conversationId: id }); }} />
  </main>;
}
