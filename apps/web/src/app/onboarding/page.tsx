import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";
import { CreateOrganizationForm } from "@/components/onboarding/create-organization-form";

async function OnboardingGate() {
  // Evita criar organização duplicada ao voltar/recarregar.
  const org = await getActiveOrg();
  if (org) redirect("/dashboard");
  return <CreateOrganizationForm />;
}

export default function OnboardingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <Suspense fallback={null}>
          <OnboardingGate />
        </Suspense>
      </div>
    </main>
  );
}
