"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hadConnection = false;
    let disposed = false;
    const invalidate = () => {
      void client.invalidateQueries({ queryKey: ["inbox", orgId] });
      void client.invalidateQueries({ queryKey: ["conversation", orgId] });
      void client.invalidateQueries({ queryKey: ["unread", orgId] });
      void client.invalidateQueries({ queryKey: ["inbox-contact", orgId] });
      void client.invalidateQueries({ queryKey: ["knowledge"] });
    };
    const changed = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(invalidate, 300);
    };
    const channel = supabase.channel(`inbox:${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `organization_id=eq.${orgId}` }, changed)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `organization_id=eq.${orgId}` }, changed)
      .on("postgres_changes", { event: "*", schema: "public", table: "knowledge_documents", filter: `organization_id=eq.${orgId}` }, changed);
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
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", focus);
      window.removeEventListener("focus", focus);
      void supabase.removeChannel(channel);
    };
  }, [client, orgId]);

  return <InboxRealtimeContext.Provider value={{ orgId, unread: unread.data, ...connection }}>
    {children}
  </InboxRealtimeContext.Provider>;
}
