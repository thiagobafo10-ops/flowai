import Link from "next/link";
import type { CartRow } from "@/lib/carts/queries";
import { COMMERCIAL_LABELS, STAGE_LABELS, label } from "@/lib/carts/labels";
import { formatDateTime } from "@/lib/crm/format";
import { money } from "./format";

const NO_DATE = "Data original não informada";

function Badges({ r }: { r: CartRow }) {
  return (
    <div className="flex flex-col items-start gap-1">
      {r.unreconciledPayment && (
        <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Pagamento não reconciliado
        </span>
      )}
      {r.blockReason && <span className="text-xs text-muted-foreground">{r.blockReason}</span>}
    </div>
  );
}

export function CartTable({ rows, timeZone }: { rows: CartRow[]; timeZone: string }) {
  const date = (r: CartRow) => (r.abandonedAt ? formatDateTime(r.abandonedAt, timeZone) : NO_DATE);
  const name = (r: CartRow) => r.customerName || "Sem nome";
  const stage = (r: CartRow) => `${label(STAGE_LABELS, r.recoveryStage)}${r.paused ? " (pausado)" : ""}`;
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              {["Cliente", "Valor", "Itens", "Abandono", "Estado", "Estágio", "Situação"].map((h) => (
                <th key={h} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id} className="align-top hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link href={`/carrinhos/${r.id}`} className="font-medium underline-offset-2 hover:underline">{name(r)}</Link>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{money(r.total)}</td>
                <td className="px-3 py-2">{r.itemsCount}</td>
                <td className="px-3 py-2 whitespace-nowrap">{date(r)}</td>
                <td className="px-3 py-2">{label(COMMERCIAL_LABELS, r.commercialStatus)}</td>
                <td className="px-3 py-2">{stage(r)}</td>
                <td className="px-3 py-2"><Badges r={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="space-y-1 rounded-xl border p-3 text-sm">
            <Link href={`/carrinhos/${r.id}`} className="font-medium underline-offset-2 hover:underline">{name(r)}</Link>
            <p>{money(r.total)} · {r.itemsCount} {r.itemsCount === 1 ? "item" : "itens"}</p>
            <p className="text-muted-foreground">{date(r)}</p>
            <p>{label(COMMERCIAL_LABELS, r.commercialStatus)} · {stage(r)}</p>
            <Badges r={r} />
          </li>
        ))}
      </ul>
    </>
  );
}
