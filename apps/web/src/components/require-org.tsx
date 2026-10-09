import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";

async function OrgGate({ children }: { children: ReactNode }) {
  const org = await getActiveOrg();
  if (!org) redirect("/onboarding");
  return <>{children}</>;
}

// Cada página faz a própria checagem de organização (o layout não é barreira de
// segurança); o conteúdo só é renderizado depois dela.
export function RequireOrg({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <OrgGate>{children}</OrgGate>
    </Suspense>
  );
}
