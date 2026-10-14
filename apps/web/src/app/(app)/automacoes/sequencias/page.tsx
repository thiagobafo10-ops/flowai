import { AutomationTabs } from "@/components/growth/automation-tabs";
import { SequencesView } from "@/components/growth/sequences";
import { RequireOrg } from "@/components/require-org";
import { getActiveOrg } from "@/lib/org/active-org";

async function Content() {
  const org = await getActiveOrg();
  return org ? <SequencesView orgId={org.id} /> : null;
}

export default function SequencesPage() {
  return (
    <RequireOrg>
      <main className="space-y-4 p-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Automações</h1>
          <p className="max-w-prose text-muted-foreground">
            Fluxos que respondem, etiquetam e transferem conversas automaticamente.
          </p>
        </div>
        <AutomationTabs />
        <Content />
      </main>
    </RequireOrg>
  );
}
