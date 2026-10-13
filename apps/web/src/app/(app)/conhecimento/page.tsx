import { DocumentList } from "@/components/knowledge/document-list";
import { RequireOrg } from "@/components/require-org";
import { getActiveOrg } from "@/lib/org/active-org";

async function Content() {
  const org = await getActiveOrg();
  return org ? <DocumentList orgId={org.id} /> : null;
}

export default function Page() {
  return (
    <RequireOrg>
      <main className="space-y-4 p-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Conhecimento</h1>
          <p className="max-w-prose text-muted-foreground">Documentos que a IA usa para responder com precisão.</p>
        </div>
        <Content />
      </main>
    </RequireOrg>
  );
}
