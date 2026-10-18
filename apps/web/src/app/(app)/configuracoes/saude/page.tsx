import { Suspense } from "react";
import { RequireOrg } from "@/components/require-org";
import { HealthSettings } from "@/components/settings/health-settings";
import { getActiveOrg } from "@/lib/org/active-org";
import { getOpsHealth } from "@/lib/ops/queries";

async function SaudeContent() {
  const org = await getActiveOrg();
  if (!org) return null;
  if (org.role !== "admin" && org.role !== "owner") {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        Você não tem permissão para esta ação.
      </p>
    );
  }
  const health = await getOpsHealth(org.id);
  return <HealthSettings health={health} />;
}

export default function SaudeSettingsPage() {
  return (
    <RequireOrg>
      <Suspense
        fallback={
          <div
            aria-busy="true"
            aria-label="Carregando saúde da operação"
            className="h-32 animate-pulse rounded-lg bg-muted/60"
          />
        }
      >
        <SaudeContent />
      </Suspense>
    </RequireOrg>
  );
}
