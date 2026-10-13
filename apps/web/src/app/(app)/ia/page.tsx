import { AgentView } from "@/components/ai/agent-view";
import { RequireOrg } from "@/components/require-org";
import { getActiveOrg } from "@/lib/org/active-org";

async function Content() {
  const org = await getActiveOrg();
  return org ? <AgentView orgId={org.id} /> : null;
}

export default function Page() {
  return (
    <RequireOrg>
      <main className="space-y-4 p-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">IA</h1>
          <p className="max-w-prose text-muted-foreground">Configure o agente de IA que atende seus clientes.</p>
        </div>
        <Content />
      </main>
    </RequireOrg>
  );
}
