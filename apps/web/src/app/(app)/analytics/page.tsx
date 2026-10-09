import { ModulePlaceholder } from "@/components/module-placeholder";
import { RequireOrg } from "@/components/require-org";

export default function Page() {
  return (
    <RequireOrg>
      <ModulePlaceholder href="/analytics" />
    </RequireOrg>
  );
}
