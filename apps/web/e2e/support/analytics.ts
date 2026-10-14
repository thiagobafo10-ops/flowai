import { expect, type Page } from "@playwright/test";

type CsvValues = {
  conversations: number;
  contacts: number;
  resolution: number;
  containment: number | null;
  pipeline: number;
  won: number;
  ticket: number;
};

/** Reads the browser's actual downloaded bytes; expectations come from the fixture/API. */
export async function expectAnalyticsCsv(page: Page, period: string, values: CsvValues) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(new RegExp(`^analytics-${period}-\\d{4}-\\d{2}-\\d{2}\\.csv$`));
  const stream = await download.createReadStream();
  if (!stream) throw new Error("CSV download has no readable stream");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(await download.failure()).toBeNull();
  const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv.startsWith("\uFEFFRelatório de Analytics - FlowAI\r\n")).toBe(true);
  const rows = csv.split("\r\n");
  expect(rows).toContain("Métrica,Valor,Tendência vs Período Anterior");
  for (const [label, value] of [
    ["Total de Conversas", values.conversations],
    ["Novos Contatos", values.contacts],
    ["Taxa de Resolução", `${values.resolution}%`],
    ["Taxa de Contenção IA", values.containment === null ? "-" : `${values.containment}%`],
    ["Total em Pipeline", `R$ ${values.pipeline}`],
    ["Valor Ganho em Vendas", `R$ ${values.won}`],
    ["Ticket Médio", `R$ ${values.ticket}`],
  ]) expect(rows.some((row) => row.startsWith(`${label},${value},`)), String(label)).toBe(true);
}
