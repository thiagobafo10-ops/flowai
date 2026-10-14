import { notFound } from "next/navigation";
import { SequenceEditor } from "@/components/growth/sequence-editor";
import { RequireOrg } from "@/components/require-org";
import { listAutomations } from "@/lib/automation/queries";
import { getSequence, listSequences } from "@/lib/growth/queries";
import { getActiveOrg } from "@/lib/org/active-org";

async function Content({ id }: { id: string }) {
  const org = await getActiveOrg();
  if (!org) return null;

  const [sequence, seqList, automations] = await Promise.all([
    getSequence(org.id, id),
    listSequences(org.id),
    listAutomations(org.id),
  ]);

  if (!sequence) notFound();

  const activeAutomations = automations
    .filter((a) => a.status === "active")
    .map((a) => ({ id: a.id, name: a.name }));

  const canWrite = ["owner", "admin"].includes(org.role);

  return (
    <SequenceEditor
      sequence={sequence}
      channels={seqList.channels}
      activeAutomations={activeAutomations}
      canWrite={canWrite}
    />
  );
}

export default async function SequenceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RequireOrg>
      <main className="p-6">
        <Content id={id} />
      </main>
    </RequireOrg>
  );
}
