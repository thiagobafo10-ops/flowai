import { CONTACT_SOURCE_LABELS, formatBrazilianPhone, type ContactSource } from "@flowai/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/crm/format";

type Props = {
  phone: string | null;
  email: string | null;
  source: ContactSource;
  createdAt: string;
  lastInteractionAt: string | null;
  timezone: string;
};

export function DataCard({ phone, email, source, createdAt, lastInteractionAt, timezone }: Props) {
  const rows: [string, string][] = [
    ["Telefone", phone ? formatBrazilianPhone(phone) : "—"],
    ["E-mail", email ?? "—"],
    ["Origem", CONTACT_SOURCE_LABELS[source]],
    ["Criado em", formatDateTime(createdAt, timezone)],
    ["Última interação", formatDateTime(lastInteractionAt, timezone)],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dados</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
