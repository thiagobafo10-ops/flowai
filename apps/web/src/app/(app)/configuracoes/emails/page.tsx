import { Suspense } from "react";
import { RequireOrg } from "@/components/require-org";
import { EmailsSettings } from "@/components/settings/emails/emails-settings";
import { getActiveOrg } from "@/lib/org/active-org";
import { loadEmailsView } from "@/lib/emails/queries";

async function EmailsContent() {
  const org = await getActiveOrg();
  if (!org) return null;
  if (org.role !== "admin" && org.role !== "owner") {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        Você não tem permissão para esta ação.
      </p>
    );
  }
  return <EmailsSettings view={await loadEmailsView(org.id)} />;
}

export default function EmailsSettingsPage() {
  return (
    <RequireOrg>
      <Suspense
        fallback={
          <div aria-busy="true" aria-label="Carregando e-mails da loja" className="h-32 animate-pulse rounded-lg bg-muted/60" />
        }
      >
        <EmailsContent />
      </Suspense>
    </RequireOrg>
  );
}
