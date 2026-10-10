import { Suspense } from "react";
import { parseKanbanFilters, type SearchParams, contactDisplayName } from "@flowai/core";
import { PipelineBoard } from "@/components/crm/kanban/board";
import { RequireOrg } from "@/components/require-org";
import { getActiveOrg } from "@/lib/org/active-org";
import { getBoard, listMembers } from "@/lib/crm/queries";
import { createServerClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<SearchParams> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function PipelineSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando pipeline" className="flex gap-3 overflow-hidden pt-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-96 w-72 shrink-0 animate-pulse rounded-xl bg-muted/60" />
      ))}
    </div>
  );
}

async function novoContactFor(orgId: string, raw: string | string[] | undefined) {
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || !UUID_RE.test(id)) return null;
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("contacts")
    .select("id, name, phone, email")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  return data ? { id: data.id, name: contactDisplayName(data) } : null;
}

async function PipelineContent({ searchParams }: Props) {
  const sp = await searchParams;
  const filters = parseKanbanFilters(sp);
  const org = await getActiveOrg();
  if (!org) return null;

  const canWrite = org.role !== "viewer";
  const [board, members, novoContact] = await Promise.all([
    getBoard(org.id, filters),
    listMembers(org.id),
    canWrite ? novoContactFor(org.id, sp.novo) : null,
  ]);

  return (
    <PipelineBoard
      orgId={org.id}
      filters={filters}
      initialBoard={board}
      members={members}
      canWrite={canWrite}
      canDelete={org.role === "admin" || org.role === "owner"}
      novoContact={novoContact}
    />
  );
}

export default function PipelinePage(props: Props) {
  return (
    <RequireOrg>
      <main className="space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Pipeline</h1>
        <Suspense fallback={<PipelineSkeleton />}>
          <PipelineContent {...props} />
        </Suspense>
      </main>
    </RequireOrg>
  );
}
