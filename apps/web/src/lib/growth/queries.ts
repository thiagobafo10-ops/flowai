import type { OutreachMessage, SendWindow, SequenceSettings } from "@flowai/core";
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

export type SequenceListItem = {
  id: string;
  name: string;
  status: "draft" | "active" | "paused";
  settings: SequenceSettings;
  stepsCount: number;
  activeEnrollments: number;
  sent7d: number;
  createdAt: string;
  updatedAt: string;
};

export type SequenceDetail = {
  id: string;
  name: string;
  status: "draft" | "active" | "paused";
  settings: SequenceSettings;
  steps: {
    id: string;
    position: number;
    delayMinutes: number;
    window: SendWindow | null;
    message: OutreachMessage;
  }[];
  createdAt: string;
  updatedAt: string;
};

export type ContactSequenceEnrollment = {
  id: string;
  sequenceId: string;
  sequenceName: string;
  currentPosition: number;
  nextSendAt: string | null;
  status: "active" | "completed" | "exited" | "removed";
  createdAt: string;
};

export type ContactSequencesPayload = {
  enrollments: ContactSequenceEnrollment[];
  availableSequences: { id: string; name: string }[];
};

export async function listSequences(
  orgId: string,
  now = new Date(),
): Promise<{ sequences: SequenceListItem[]; channels: GrowthChannel[] }> {
  const db = await createServerClient();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [seqRes, stepsRes, enrollRes, delivRes, chRes] = await Promise.all([
    db
      .from("sequences")
      .select("id, name, status, settings, created_at, updated_at")
      .eq("organization_id", orgId)
      .order("updated_at", { ascending: false }),
    db
      .from("sequence_steps")
      .select("id, sequence_id")
      .eq("organization_id", orgId)
      .is("removed_at", null),
    db
      .from("sequence_enrollments")
      .select("id, sequence_id")
      .eq("organization_id", orgId)
      .eq("status", "active"),
    db
      .from("outreach_deliveries")
      .select("id, step_id")
      .eq("organization_id", orgId)
      .eq("source", "sequence")
      .eq("status", "sent")
      .gte("created_at", sevenDaysAgo.toISOString()),
    db
      .from("channels")
      .select("id, name, type, status, instagram_username")
      .eq("organization_id", orgId),
  ]);

  if (seqRes.error) throw seqRes.error;
  if (stepsRes.error) throw stepsRes.error;
  if (enrollRes.error) throw enrollRes.error;
  if (delivRes.error) throw delivRes.error;
  if (chRes.error) throw chRes.error;

  const stepToSeq = new Map<string, string>();
  const stepsPerSeq = new Map<string, number>();
  for (const s of stepsRes.data ?? []) {
    stepToSeq.set(s.id, s.sequence_id);
    stepsPerSeq.set(s.sequence_id, (stepsPerSeq.get(s.sequence_id) ?? 0) + 1);
  }

  const enrollPerSeq = new Map<string, number>();
  for (const e of enrollRes.data ?? []) {
    enrollPerSeq.set(e.sequence_id, (enrollPerSeq.get(e.sequence_id) ?? 0) + 1);
  }

  const sentPerSeq = new Map<string, number>();
  for (const d of delivRes.data ?? []) {
    if (d.step_id) {
      const seqId = stepToSeq.get(d.step_id);
      if (seqId) sentPerSeq.set(seqId, (sentPerSeq.get(seqId) ?? 0) + 1);
    }
  }

  const sequences: SequenceListItem[] = (seqRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status as "draft" | "active" | "paused",
    settings: s.settings as SequenceSettings,
    stepsCount: stepsPerSeq.get(s.id) ?? 0,
    activeEnrollments: enrollPerSeq.get(s.id) ?? 0,
    sent7d: sentPerSeq.get(s.id) ?? 0,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  }));

  return { sequences, channels: (chRes.data ?? []) as GrowthChannel[] };
}

export async function getSequence(orgId: string, sequenceId: string): Promise<SequenceDetail | null> {
  const db = await createServerClient();

  const [seqRes, stepsRes] = await Promise.all([
    db
      .from("sequences")
      .select("id, name, status, settings, created_at, updated_at")
      .eq("organization_id", orgId)
      .eq("id", sequenceId)
      .maybeSingle(),
    db
      .from("sequence_steps")
      .select("id, position, delay_minutes, window, message")
      .eq("organization_id", orgId)
      .eq("sequence_id", sequenceId)
      .is("removed_at", null)
      .order("position", { ascending: true }),
  ]);

  if (seqRes.error) throw seqRes.error;
  if (stepsRes.error) throw stepsRes.error;
  if (!seqRes.data) return null;

  return {
    id: seqRes.data.id,
    name: seqRes.data.name,
    status: seqRes.data.status as "draft" | "active" | "paused",
    settings: seqRes.data.settings as SequenceSettings,
    steps: (stepsRes.data ?? []).map((step) => ({
      id: step.id,
      position: step.position ?? 1,
      delayMinutes: step.delay_minutes,
      window: step.window as SendWindow | null,
      message: step.message as OutreachMessage,
    })),
    createdAt: seqRes.data.created_at,
    updatedAt: seqRes.data.updated_at,
  };
}

export async function getContactSequences(orgId: string, contactId: string): Promise<ContactSequencesPayload> {
  const db = await createServerClient();

  const [enrollRes, activeSeqRes] = await Promise.all([
    db
      .from("sequence_enrollments")
      .select("id, sequence_id, current_position, next_send_at, status, created_at, sequences(name)")
      .eq("organization_id", orgId)
      .eq("contact_id", contactId)
      .eq("status", "active")
      .order("created_at", { ascending: false }),
    db
      .from("sequences")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("status", "active")
      .order("name", { ascending: true }),
  ]);

  if (enrollRes.error) throw enrollRes.error;
  type EnrollmentRow = {
    id: string;
    sequence_id: string;
    current_position: number;
    next_send_at: string | null;
    status: "active" | "completed" | "exited" | "removed";
    created_at: string;
    sequences: { name: string } | null;
  };

  const rawRows = (enrollRes.data ?? []) as unknown as EnrollmentRow[];
  const enrollments: ContactSequenceEnrollment[] = rawRows.map((e) => ({
    id: e.id,
    sequenceId: e.sequence_id,
    sequenceName: e.sequences?.name ?? "Sequência",
    currentPosition: e.current_position,
    nextSendAt: e.next_send_at,
    status: e.status,
    createdAt: e.created_at,
  }));

  const enrolledSeqIds = new Set(enrollments.map((e) => e.sequenceId));
  const availableSequences = (activeSeqRes.data ?? []).filter((s) => !enrolledSeqIds.has(s.id));

  return { enrollments, availableSequences };
}

export type CampaignStatus = "draft" | "scheduled" | "sending" | "completed" | "cancelled";

export type CampaignListItem = {
  id: string;
  name: string;
  status: CampaignStatus;
  scheduledAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  sentCount: number;
  totalRecipients: number;
};

export async function listCampaigns(orgId: string): Promise<CampaignListItem[]> {
  const db = await createServerClient();

  const [campaignsRes, deliveriesRes] = await Promise.all([
    db
      .from("campaigns")
      .select("id, name, status, scheduled_at, finished_at, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false }),
    db
      .from("outreach_deliveries")
      .select("campaign_id, status")
      .eq("organization_id", orgId)
      .not("campaign_id", "is", null),
  ]);

  if (campaignsRes.error) throw campaignsRes.error;
  if (deliveriesRes.error) throw deliveriesRes.error;

  const totalMap = new Map<string, number>();
  const sentMap = new Map<string, number>();

  for (const d of deliveriesRes.data ?? []) {
    if (!d.campaign_id) continue;
    totalMap.set(d.campaign_id, (totalMap.get(d.campaign_id) ?? 0) + 1);
    if (d.status === "sent") {
      sentMap.set(d.campaign_id, (sentMap.get(d.campaign_id) ?? 0) + 1);
    }
  }

  return (campaignsRes.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status as CampaignStatus,
    scheduledAt: c.scheduled_at,
    finishedAt: c.finished_at,
    createdAt: c.created_at,
    sentCount: sentMap.get(c.id) ?? 0,
    totalRecipients: totalMap.get(c.id) ?? 0,
  }));
}

export type CampaignDetails = {
  id: string;
  name: string;
  status: CampaignStatus;
  audience: import("@flowai/core").AudienceFilter;
  message: import("@flowai/core").OutreachMessage;
  scheduledAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function getCampaign(orgId: string, id: string): Promise<CampaignDetails | null> {
  const db = await createServerClient();
  const { data, error } = await db
    .from("campaigns")
    .select("id, name, status, audience, message, scheduled_at, finished_at, created_at, updated_at")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    status: data.status as CampaignStatus,
    audience: data.audience as import("@flowai/core").AudienceFilter,
    message: data.message as import("@flowai/core").OutreachMessage,
    scheduledAt: data.scheduled_at,
    finishedAt: data.finished_at,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export type CampaignReportPayload = {
  counts: {
    sent: number;
    cancelled: number;
    skipped: Record<string, number>;
    failed: Record<string, number>;
  };
  clicks: Record<string, number>;
  recipients: Array<{
    id: string;
    contact_id: string;
    contact_name: string | null;
    channel_id: string;
    conversation_id: string;
    status: string;
    reason: string | null;
    run_after: string;
    message_id: string | null;
    created_at: string;
  }>;
};

export async function getCampaignReport(
  id: string,
  limit = 50,
  offset = 0,
): Promise<CampaignReportPayload> {
  const db = await createServerClient();
  const { data, error } = await db.rpc("campaign_report", {
    p_id: id,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) throw error;
  return data as CampaignReportPayload;
}

export type CampaignFilterRefs = {
  channels: { id: string; name: string; type: string }[];
  tags: { id: string; name: string }[];
  stages: { id: string; name: string }[];
  entryLinks: { id: string; name: string }[];
  automations: { id: string; name: string }[];
};

export async function loadCampaignFilterRefs(orgId: string): Promise<CampaignFilterRefs> {
  const db = await createServerClient();
  const [channelsRes, tagsRes, pipelineRes, linksRes, automationsRes] = await Promise.all([
    db.from("channels").select("id, name, type").eq("organization_id", orgId).order("name"),
    db.from("tags").select("id, name").eq("organization_id", orgId).order("name"),
    db.from("pipelines").select("id").eq("organization_id", orgId).eq("is_default", true).maybeSingle(),
    db.from("entry_links").select("id, name").eq("organization_id", orgId).order("name"),
    db.from("automations").select("id, name").eq("organization_id", orgId).eq("status", "active").order("name"),
  ]);

  if (channelsRes.error) throw channelsRes.error;
  if (tagsRes.error) throw tagsRes.error;
  if (pipelineRes.error) throw pipelineRes.error;
  if (linksRes.error) throw linksRes.error;
  if (automationsRes.error) throw automationsRes.error;

  let stages: { id: string; name: string }[] = [];
  if (pipelineRes.data?.id) {
    const stagesRes = await db
      .from("pipeline_stages")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("pipeline_id", pipelineRes.data.id)
      .order("position");
    if (stagesRes.error) throw stagesRes.error;
    stages = stagesRes.data ?? [];
  }

  return {
    channels: channelsRes.data ?? [],
    tags: tagsRes.data ?? [],
    stages,
    entryLinks: linksRes.data ?? [],
    automations: automationsRes.data ?? [],
  };
}
