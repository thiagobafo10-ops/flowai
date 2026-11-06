import { cancelReasonLabel, JOURNEY_LABELS } from "@/lib/emails/schemas";
import type { EmailSendRow } from "@/lib/emails/queries";

const STATE: Record<string, string> = { scheduled: "Agendado", sending: "Enviando", sent: "Enviado", cancelled: "Cancelado", failed: "Falhou" };
const date = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const journeyLabel = (s: EmailSendRow) => (s.kind ? JOURNEY_LABELS[s.kind] : "—");

function status(s: EmailSendRow): string {
  if (s.state === "cancelled") return `Cancelado: ${cancelReasonLabel(s.cancelReason ?? "")}`;
  if (s.bouncedAt) return "Devolvido";
  if (s.clickedAt) return "Clicou";
  if (s.openedAt) return "Abriu";
  if (s.deliveredAt) return "Entregue";
  return STATE[s.state] ?? s.state;
}

export function SendHistory({ sends }: { sends: EmailSendRow[] }) {
  if (!sends.length) return <p className="text-sm text-muted-foreground">Nenhum e-mail agendado ainda.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Últimos 100 envios</caption>
        <thead className="text-left text-muted-foreground">
          <tr><th className="py-2 pr-4 font-medium">Envio</th><th className="py-2 pr-4 font-medium">Para</th><th className="py-2 pr-4 font-medium">Jornada</th><th className="py-2 pr-4 font-medium">E-mail</th><th className="py-2 font-medium">Estado</th></tr>
        </thead>
        <tbody>
          {sends.map((s) => (
            <tr key={s.id} className="border-t">
              <td className="py-2 pr-4 whitespace-nowrap">{date(s.sendAt)}</td>
              <td className="py-2 pr-4">{s.toEmail}</td>
              <td className="py-2 pr-4 whitespace-nowrap">{journeyLabel(s)}</td>
              <td className="py-2 pr-4">{s.position ?? "—"}</td>
              <td className="py-2">{status(s)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
