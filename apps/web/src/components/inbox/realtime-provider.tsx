"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { realtimeInvalidations, type RealtimeTable } from "@/lib/inbox/realtime-keys";
import { createBrowserClient } from "@/lib/supabase/client";

const InboxRealtimeContext = createContext({ orgId: "", unread: 0, connected: false, reconnecting: false });
export const useInboxRealtime = () => useContext(InboxRealtimeContext);

export function RealtimeProvider({ orgId, initialUnread, children }: {
  orgId: string; initialUnread: number; children: ReactNode;
}) {
  const client = useQueryClient();
  const [connection, setConnection] = useState({ connected: false, reconnecting: false });
  const unread = useQuery({
    queryKey: ["unread", orgId],
    queryFn: async () => {
      const response = await fetch("/api/inbox/nao-lidas", { cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível carregar o Inbox.");
      return (await response.json() as { count: number }).count;
    },
    initialData: initialUnread,
  });

  useEffect(() => {
    const supabase = createBrowserClient();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    let hadConnection = false;
    let disposed = false;
    const invalidateFor = (table: RealtimeTable) => {
      for (const queryKey of realtimeInvalidations(table, orgId)) void client.invalidateQueries({ queryKey });
    };
    const invalidate = () => {
      invalidateFor("messages");
      invalidateFor("knowledge_documents");
    };
    // Um debounce por área: mudanças no Inbox não recarregam a base de conhecimento e vice-versa.
    const changed = (area: "inbox" | "knowledge", table: RealtimeTable) => () => {
      const pending = timers.get(area);
      if (pending) clearTimeout(pending);
      timers.set(area, setTimeout(() => invalidateFor(table), 300));
    };
    const inboxChanged = changed("inbox", "messages");
    const filter = `organization_id=eq.${orgId}`;
    const channel = supabase.channel(`inbox:${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter }, inboxChanged)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter }, inboxChanged)
      .on("postgres_changes", { event: "*", schema: "public", table: "knowledge_documents", filter }, changed("knowledge", "knowledge_documents"));
    void (async () => {
      // subscribe captures the current token in its join payload. Wait for Auth
      // to load the browser cookie session before opening a protected subscription.
      await supabase.realtime.setAuth();
      if (disposed) return;
      channel.subscribe((status) => {
        if (disposed) return;
        if (status === "SUBSCRIBED") {
          hadConnection = true;
          setConnection({ connected: true, reconnecting: false });
          // Covers messages received between the server render and subscription.
          invalidate();
        } else {
          setConnection({ connected: false, reconnecting: hadConnection });
        }
      });
    })().catch((error: unknown) => {
      if (!disposed) console.error("inbox realtime authentication failed", error);
    });
    const focus = () => invalidate();
    window.addEventListener("online", focus);
    window.addEventListener("focus", focus);
    return () => {
      disposed = true;
      for (const pending of timers.values()) clearTimeout(pending);
      window.removeEventListener("online", focus);
      window.removeEventListener("focus", focus);
      void supabase.removeChannel(channel);
    };
  }, [client, orgId]);

  return <InboxRealtimeContext.Provider value={{ orgId, unread: unread.data, ...connection }}>
    {children}
  </InboxRealtimeContext.Provider>;
}
