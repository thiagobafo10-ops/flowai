import { Suspense } from "react";
import { RequireOrg } from "@/components/require-org";
import { TagsSettings } from "@/components/crm/tags-settings";
import { getActiveOrg } from "@/lib/org/active-org";
import { listTags } from "@/lib/crm/queries";

async function TagsContent() {
  const org = await getActiveOrg();
  if (!org) return null;
  const tags = await listTags(org.id);
  return (
    <TagsSettings
      tags={tags}
      canCreate={org.role !== "viewer"}
      canManage={org.role === "admin" || org.role === "owner"}
    />
  );
}

export default function TagsPage() {
  return (
    <RequireOrg>
      <Suspense
        fallback={
          <div aria-busy="true" aria-label="Carregando tags" className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/60" />
            ))}
          </div>
        }
      >
        <TagsContent />
      </Suspense>
    </RequireOrg>
  );
}
