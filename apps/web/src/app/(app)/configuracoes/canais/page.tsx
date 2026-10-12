import { Suspense } from "react";
import { RequireOrg } from "@/components/require-org";
import { ChannelsSettings } from "@/components/settings/channels-settings";
import { getActiveOrg } from "@/lib/org/active-org";
import { listChannels } from "@/lib/inbox/queries";
import { listInstagramSettings } from "@/lib/instagram/queries";

async function CanaisContent() {
  const org = await getActiveOrg();
  if (!org) return null;
  if (org.role !== "admin" && org.role !== "owner") {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        Você não tem permissão para esta ação.
      </p>
    );
  }
  const [channels, instagram] = await Promise.all([listChannels(org.id), listInstagramSettings(org.id)]);
  return <ChannelsSettings channels={channels} instagram={instagram} />;
}

export default function CanaisSettingsPage() {
  return (
    <RequireOrg>
      <Suspense
        fallback={
          <div aria-busy="true" aria-label="Carregando canais" className="h-32 animate-pulse rounded-lg bg-muted/60" />
        }
      >
        <CanaisContent />
      </Suspense>
    </RequireOrg>
  );
}
