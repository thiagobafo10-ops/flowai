import { Suspense } from "react";
import { parseInboxParams, type SearchParams } from "@flowai/core";
import { RequireOrg } from "@/components/require-org";
import { InboxShell } from "@/components/inbox/inbox-shell";
import { getActiveOrg } from "@/lib/org/active-org";
import { listConversations, getConversation, listChannels } from "@/lib/inbox/queries";
import { getOrgTimezone, listMembers } from "@/lib/crm/queries";
import { createServerClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<SearchParams> };
async function InboxContent({ searchParams }: Props) {
  const org = await getActiveOrg();
  if (!org) return null;
  const filters = parseInboxParams(await searchParams);
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const [initialList, initialConversation, channels, members, timezone] = await Promise.all([
    listConversations(org.id, filters), filters.conversationId ? getConversation(org.id, filters.conversationId) : null,
    listChannels(org.id), listMembers(org.id), getOrgTimezone(org.id),
  ]);
  return <InboxShell orgId={org.id} userId={user.id} filters={filters} initialList={initialList} initialConversation={initialConversation} channels={channels} members={members} canWrite={org.role !== "viewer"} canAdmin={org.role === "admin" || org.role === "owner"} timezone={timezone} now={new Date().toISOString()} />;
}
export default function InboxPage(props: Props) {
  return <RequireOrg><Suspense fallback={<div aria-busy="true" className="h-[calc(100dvh-3.5rem)] animate-pulse bg-muted/40" />}><InboxContent {...props} /></Suspense></RequireOrg>;
}
