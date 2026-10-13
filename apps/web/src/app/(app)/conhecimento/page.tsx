import { DocumentList } from "@/components/knowledge/document-list";
import { RequireOrg } from "@/components/require-org";

export default function Page() {
  return (
    <RequireOrg>
      <main className="space-y-4 p-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Conhecimento</h1>
          <p className="max-w-prose text-muted-foreground">Documentos que a IA usa para responder com precisão.</p>
        </div>
        <DocumentList />
      </main>
    </RequireOrg>
  );
}
