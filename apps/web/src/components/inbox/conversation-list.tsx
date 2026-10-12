"use client";

import { useState } from "react";
import { INBOX_TABS, type InboxTab } from "@flowai/core";
import type { ChannelRow, listConversations } from "@/lib/inbox/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConversationItem } from "./conversation-item";
import { useInboxRealtime } from "./realtime-provider";

export type InboxPage = Awaited<ReturnType<typeof listConversations>>;
export type InboxFilters = { tab: InboxTab; q: string; channelId: string | null; conversationId: string | null };

export function ConversationList({ data, filters, channels, hasSimulator, canSimulate, busy, now, timezone, onFilters, onSelect, onMore, onSimulate }: {
  data: InboxPage; filters: InboxFilters; channels: ChannelRow[]; hasSimulator: boolean; canSimulate: boolean;
  busy: boolean; now: string; timezone: string; onFilters: (patch: Partial<InboxFilters>) => void;
  onSelect: (id: string) => void; onMore: () => void; onSimulate: () => void;
}) {
  const [search, setSearch] = useState(filters.q);
  const { reconnecting } = useInboxRealtime();
  const total = data.counts.todas;
  const noFilters = filters.tab === "todas" && !filters.q && !filters.channelId;
  return (
    <section role="region" aria-label="Lista de conversas" aria-busy={busy} className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b p-4">
        <div className="flex items-center justify-between gap-2"><h1 className="text-lg font-semibold">Inbox</h1>{canSimulate && <Button size="sm" variant="outline" onClick={onSimulate}>Simular mensagem</Button>}</div>
        {reconnecting && <p role="status" className="text-xs text-muted-foreground">Reconectando…</p>}
        <nav aria-label="Abas do Inbox" className="flex flex-wrap gap-1">
          {INBOX_TABS.map((tab) => <Button key={tab.value} size="xs" variant={filters.tab === tab.value ? "secondary" : "ghost"} aria-pressed={filters.tab === tab.value} onClick={() => onFilters({ tab: tab.value })}>
            {tab.label}{tab.value !== "fechadas" && <span className="text-muted-foreground">{data.counts[tab.value]}</span>}
          </Button>)}
        </nav>
        <form onSubmit={(event) => { event.preventDefault(); onFilters({ q: search }); }} className="flex gap-2">
          <Input aria-label="Buscar conversas" placeholder="Buscar conversas" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} />
          <Button variant="outline" type="submit" size="sm">Buscar</Button>
        </form>
        {channels.length > 1 && <select aria-label="Filtrar canal" className="h-8 w-full rounded-lg border px-2 text-sm" value={filters.channelId ?? ""} onChange={(event) => onFilters({ channelId: event.target.value || null })}>
          <option value="">Todos os canais</option>{channels.map((channel) => <option value={channel.id} key={channel.id}>{channel.name}</option>)}
        </select>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {data.items.map((item) => <ConversationItem key={item.id} item={item} selected={filters.conversationId === item.id} now={now} timezone={timezone} onSelect={() => onSelect(item.id)} />)}
        {!data.items.length && <div className="space-y-2 px-5 py-12 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{total === 0 && noFilters ? "Nenhuma conversa ainda" : "Nada por aqui"}</p>
          {total === 0 && noFilters && <p>{hasSimulator ? "Simule uma mensagem" : "Conecte um canal em Configurações → Canais"}</p>}
        </div>}
        {data.nextCursor && <div className="p-4 text-center"><Button variant="outline" disabled={busy} onClick={onMore}>Carregar mais</Button></div>}
      </div>
    </section>
  );
}
