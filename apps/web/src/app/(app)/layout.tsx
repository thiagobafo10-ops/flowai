import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";
import { signOut } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";

async function AppShell({ children }: { children: React.ReactNode }) {
  const org = await getActiveOrg();
  if (!org) redirect("/onboarding");
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <span className="font-medium">{org.name}</span>
        <form action={signOut}>
          <Button type="submit" variant="outline" size="sm">
            Sair
          </Button>
        </form>
      </header>
      {children}
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
