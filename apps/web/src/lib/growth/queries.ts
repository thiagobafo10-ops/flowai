import { createServerClient } from "@/lib/supabase/server";
import { readyEntryLink } from "./link";

export type EntryLinkAutomation = {
  id: string;
  name: string;
  status: string;
};

export type GrowthChannel = {
  id: string;
  name: string;
  type: string;
  status: string;
  instagram_username: string | null;
};

export type GrowthTag = {
  id: string;
  name: string;
};

export type EntryLinkItem = {
  id: string;
  name: string;
  channel_id: string;
  code: string;
  tag_id: string | null;
  status: "active" | "archived";
  created_at: string;
  channel?: GrowthChannel;
  tag?: GrowthTag | null;
  url: string | null;
  usesTotal: number;
  uses7d: number;
  automations: EntryLinkAutomation[];
};

export type EntryLinksPayload = {
  links: EntryLinkItem[];
  channels: GrowthChannel[];
  tags: GrowthTag[];
};

export async function listEntryLinks(orgId: string, now = new Date()): Promise<EntryLinksPayload> {
  const db = await createServerClient();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [channelsRes, tagsRes, linksRes, automationsRes] = await Promise.all([
    db
      .from("channels")
      .select("id, name, type, status, instagram_username")
      .eq("organization_id", orgId),
    db
      .from("tags")
      .select("id, name")
      .eq("organization_id", orgId),
    db
      .from("entry_links")
      .select("id, name, channel_id, code, tag_id, status, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false }),
    db
      .from("automations")
      .select("id, name, trigger_config, status")
      .eq("organization_id", orgId)
      .eq("trigger_type", "entry_link"),
  ]);

  if (channelsRes.error) throw channelsRes.error;
  if (tagsRes.error) throw tagsRes.error;
  if (linksRes.error) throw linksRes.error;
  if (automationsRes.error) throw automationsRes.error;

  const channels = (channelsRes.data ?? []) as GrowthChannel[];
  const tags = (tagsRes.data ?? []) as GrowthTag[];
  const rawLinks = (linksRes.data ?? []) as {
    id: string;
    name: string;
    channel_id: string;
    code: string;
    tag_id: string | null;
    status: "active" | "archived";
    created_at: string;
  }[];
  const automations = (automationsRes.data ?? []) as {
    id: string;
    name: string;
    trigger_config: unknown;
    status: string;
  }[];

  const channelMap = new Map(channels.map((ch) => [ch.id, ch]));
  const tagMap = new Map(tags.map((t) => [t.id, t]));

  const linksWithCounts = await Promise.all(
    rawLinks.map(async (link) => {
      const channel = channelMap.get(link.channel_id);
      const tag = link.tag_id ? tagMap.get(link.tag_id) ?? null : null;
      const url = channel
        ? readyEntryLink(
            { type: channel.type, username: channel.instagram_username },
            link.code,
          )
        : null;

      const [totalRes, weekRes] = await Promise.all([
        db
          .from("entry_link_hits")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("link_id", link.id),
        db
          .from("entry_link_hits")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("link_id", link.id)
          .gte("created_at", sevenDaysAgo.toISOString()),
      ]);

      if (totalRes.error) throw totalRes.error;
      if (weekRes.error) throw weekRes.error;

      const linkedAutomations: EntryLinkAutomation[] = [];
      for (const auto of automations) {
        const cfg = auto.trigger_config as { linkIds?: string[] } | null;
        if (Array.isArray(cfg?.linkIds) && cfg.linkIds.includes(link.id)) {
          linkedAutomations.push({
            id: auto.id,
            name: auto.name,
            status: auto.status,
          });
        }
      }

      return {
        ...link,
        channel,
        tag,
        url,
        usesTotal: totalRes.count ?? 0,
        uses7d: weekRes.count ?? 0,
        automations: linkedAutomations,
      };
    }),
  );

  return {
    links: linksWithCounts,
    channels,
    tags,
  };
}
