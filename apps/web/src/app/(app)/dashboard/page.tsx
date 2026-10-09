import { Suspense } from "react";
import { getActiveOrg } from "@/lib/org/active-org";

async function OrgName() {
  const org = await getActiveOrg();
  return <p className="text-muted-foreground">{org?.name}</p>;
}

export default function DashboardPage() {
  return (
    <main className="space-y-2 p-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <Suspense fallback={null}>
        <OrgName />
      </Suspense>
      <p className="pt-4 text-sm text-muted-foreground">
        Ainda não há dados. Conecte um canal para começar a receber conversas.
      </p>
    </main>
  );
}
