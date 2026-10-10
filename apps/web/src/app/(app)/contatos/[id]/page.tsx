import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { contactDisplayName } from "@flowai/core";
import { ContactHeader } from "@/components/crm/contact-detail/header";
import { CustomFieldsCard } from "@/components/crm/contact-detail/custom-fields-card";
import { DataCard } from "@/components/crm/contact-detail/data-card";
import { DealCard } from "@/components/crm/contact-detail/deal-card";
import { HistoryCard } from "@/components/crm/contact-detail/history-card";
import { TagsCard } from "@/components/crm/contact-detail/tags-card";
import { RequireOrg } from "@/components/require-org";
import { getContact, listMembers, listTags } from "@/lib/crm/queries";
import { getActiveOrg } from "@/lib/org/active-org";

type Props = { params: Promise<{ id: string }> };

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando contato" className="space-y-3">
      <div className="h-14 animate-pulse rounded-lg bg-muted" />
      <div className="h-40 animate-pulse rounded-lg bg-muted/60" />
    </div>
  );
}

async function ContactDetailContent({ params }: Props) {
  const { id } = await params;
  const org = await getActiveOrg();
  if (!org) return null;

  const [contact, allTags, members] = await Promise.all([
    getContact(org.id, id),
    listTags(org.id),
    listMembers(org.id),
  ]);
  if (!contact) notFound();

  const canEdit = org.role !== "viewer";
  const canDelete = org.role === "admin" || org.role === "owner";
  const pickerTags = allTags.map(({ id, name, color }) => ({ id, name, color }));

  return (
    <div className="space-y-4">
      <Link href="/contatos" className="text-sm text-muted-foreground underline underline-offset-2">
        Contatos
      </Link>
      <ContactHeader
        contactId={contact.id}
        displayName={contactDisplayName(contact)}
        status={contact.status}
        leadScore={contact.leadScore}
        assigneeName={contact.assigneeName}
        canEdit={canEdit}
        canDelete={canDelete}
        allTags={pickerTags}
        members={members}
        values={{
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
          status: contact.status,
          assignedTo: contact.assignedTo,
          tagIds: contact.tags.map((t) => t.id),
          leadScore: contact.leadScore,
          customFields: contact.customFields,
        }}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <DataCard
            phone={contact.phone}
            email={contact.email}
            source={contact.source}
            createdAt={contact.createdAt}
            lastInteractionAt={contact.lastInteractionAt}
            timezone={contact.timezone}
          />
          <TagsCard contactId={contact.id} tags={contact.tags} allTags={pickerTags} canEdit={canEdit} />
          <CustomFieldsCard contactId={contact.id} fields={contact.customFields} canEdit={canEdit} />
        </div>
        <div className="space-y-4">
          <DealCard contactId={contact.id} deals={contact.deals} canCreate={canEdit} timezone={contact.timezone} />
          <HistoryCard events={contact.events} timezone={contact.timezone} />
        </div>
      </div>
    </div>
  );
}

export default function ContactDetailPage(props: Props) {
  return (
    <RequireOrg>
      <main className="p-6">
        <Suspense fallback={<DetailSkeleton />}>
          <ContactDetailContent {...props} />
        </Suspense>
      </main>
    </RequireOrg>
  );
}
