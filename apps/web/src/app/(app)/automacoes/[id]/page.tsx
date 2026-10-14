import { AutomationEditorLoader } from "@/components/automation/editor-loader";
import { RequireOrg } from "@/components/require-org";
import { getActiveOrg } from "@/lib/org/active-org";

type Props = { params: Promise<{ id: string }> };

async function Content({ params }: Props) {
  const [{ id }, org] = await Promise.all([params, getActiveOrg()]);
  return org ? <AutomationEditorLoader orgId={org.id} id={id} /> : null;
}

export default function Page(props: Props) {
  return (
    <RequireOrg>
      <main>
        <h1 className="sr-only">Editor de automação</h1>
        <Content {...props} />
      </main>
    </RequireOrg>
  );
}
