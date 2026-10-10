import { Suspense, type ReactNode } from "react";
import { SettingsTabs } from "@/components/crm/settings-tabs";
import { getActiveOrg } from "@/lib/org/active-org";

async function Tabs() {
  const org = await getActiveOrg();
  if (!org) return null;
  return <SettingsTabs showPipeline={org.role === "admin" || org.role === "owner"} />;
}

export default function ConfiguracoesLayout({ children }: { children: ReactNode }) {
  return (
    <main className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Configurações</h1>
      <Suspense fallback={<div className="h-9" aria-hidden="true" />}>
        <Tabs />
      </Suspense>
      {children}
    </main>
  );
}
