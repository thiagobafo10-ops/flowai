import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServerClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/shell/app-header";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { SIDEBAR_COOKIE } from "@/lib/sidebar-cookie";
import { RealtimeProvider } from "@/components/inbox/realtime-provider";
import { getUnreadCount } from "@/lib/inbox/unread-queries";

// O layout não é barreira de segurança: cada página e Server Action chama getActiveOrg().
async function AppShell({ children }: { children: React.ReactNode }) {
  const org = await getActiveOrg();
  if (!org) redirect("/onboarding");

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  const cookieStore = await cookies();
  const collapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === "collapsed";
  const initialUnread = await getUnreadCount(org.id);

  return (
    <RealtimeProvider key={org.id} orgId={org.id} initialUnread={initialUnread}>
    <div className="flex min-h-screen">
      <AppSidebar orgName={org.name} role={org.role} initialCollapsed={collapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          orgName={org.name}
          role={org.role}
          userName={profile?.full_name ?? ""}
          userEmail={user.email ?? ""}
        />
        <div className="flex-1">{children}</div>
      </div>
    </div>
    </RealtimeProvider>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
