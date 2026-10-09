import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ModulePlaceholder } from "@/components/module-placeholder";
import { getActiveOrg } from "@/lib/org/active-org";

async function RequireOrg() {
  const org = await getActiveOrg();
  if (!org) redirect("/onboarding");
  return null;
}

export default function Page() {
  return (
    <>
      <Suspense fallback={null}>
        <RequireOrg />
      </Suspense>
      <ModulePlaceholder href="/analytics" />
    </>
  );
}
