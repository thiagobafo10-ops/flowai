import { Suspense } from "react";
import { RequireOrg } from "@/components/require-org";
import { StagesSettings } from "@/components/crm/stages-settings";
import { getActiveOrg } from "@/lib/org/active-org";
import { getStagesWithCounts } from "@/lib/crm/queries";

async function PipelineContent() {
  const org = await getActiveOrg();
  if (!org) return null;
  if (org.role !== "admin" && org.role !== "owner") {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        Você não tem permissão para esta ação.
      </p>
    );
  }
  const { stages } = await getStagesWithCounts(org.id);
  return <StagesSettings stages={stages} />;
}

export default function PipelineSettingsPage() {
  return (
    <RequireOrg>
      <Suspense
        fallback={
          <div aria-busy="true" aria-label="Carregando etapas" className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/60" />
            ))}
          </div>
        }
      >
        <PipelineContent />
      </Suspense>
    </RequireOrg>
  );
}
