const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percent = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatInteger(n: number): string {
  return integer.format(n);
}

export function formatBRL(n: number): string {
  return brl.format(n);
}

export function formatPercent(rate: number | null): string {
  return rate === null ? "—" : percent.format(rate);
}
