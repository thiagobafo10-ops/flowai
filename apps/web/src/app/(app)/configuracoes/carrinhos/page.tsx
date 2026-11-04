import { Suspense } from "react";
import { RequireOrg } from "@/components/require-org";
import { RecoverySettings } from "@/components/carts/recovery-settings";
import { getActiveOrg } from "@/lib/org/active-org";
import { getRecoverySettings } from "@/lib/carts/queries";

async function CartsSettingsContent() {
  const org = await getActiveOrg();
  if (!org) return null;
  if (org.role !== "admin" && org.role !== "owner") {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        Você não tem permissão para esta ação.
      </p>
    );
  }
  const settings = await getRecoverySettings(org.id);
  // key: remonta com os hosts normalizados pelo servidor depois de salvar
  return <RecoverySettings key={settings.hosts.join()} {...settings} storeName={org.name} />;
}

export default function CartsSettingsPage() {
  return (
    <RequireOrg>
      <Suspense
        fallback={<div aria-busy="true" aria-label="Carregando configurações de carrinhos" className="h-32 animate-pulse rounded-lg bg-muted/60" />}
      >
        <CartsSettingsContent />
      </Suspense>
    </RequireOrg>
  );
}
