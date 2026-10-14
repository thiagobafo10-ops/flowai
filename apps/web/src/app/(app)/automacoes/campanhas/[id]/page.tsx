import { notFound } from "next/navigation";
import { CampaignReport } from "@/components/growth/campaign-report";
import { CampaignWizard } from "@/components/growth/campaign-wizard";
import { RequireOrg } from "@/components/require-org";
import { getCampaign, getCampaignReport, loadCampaignFilterRefs } from "@/lib/growth/queries";
import { getActiveOrg } from "@/lib/org/active-org";

async function Content({ id }: { id: string }) {
  const org = await getActiveOrg();
  if (!org) return null;

  const [campaign, refs] = await Promise.all([
    getCampaign(org.id, id),
    loadCampaignFilterRefs(org.id),
  ]);

  if (!campaign) notFound();

  const canWrite = ["owner", "admin"].includes(org.role);

  if (campaign.status === "draft") {
    return <CampaignWizard campaign={campaign} refs={refs} canWrite={canWrite} />;
  }

  const report = await getCampaignReport(id, 50, 0);
  return <CampaignReport campaign={campaign} initialReport={report} canWrite={canWrite} />;
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RequireOrg>
      <main className="p-6">
        <Content id={id} />
      </main>
    </RequireOrg>
  );
}
