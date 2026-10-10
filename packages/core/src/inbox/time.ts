function parts(d: Date, timeZone: string, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("pt-BR", { timeZone, hourCycle: "h23", ...opts }).formatToParts(d)) {
    out[p.type] = p.value;
  }
  return out;
}

function ymd(d: Date, timeZone: string) {
  const p = parts(d, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" });
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

function dayNumber(d: Date, timeZone: string): number {
  const { y, m, d: day } = ymd(d, timeZone);
  return Math.floor(Date.UTC(y, m - 1, day) / 86_400_000);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatRelativeTime(iso: string, now: Date, timeZone: string): string {
  const date = new Date(iso);
  const diffMs = now.getTime() - date.getTime();
  if (diffMs >= 0 && diffMs < 60_000) return "agora";
  if (diffMs >= 60_000 && diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} min`;
  const days = dayNumber(now, timeZone) - dayNumber(date, timeZone);
  if (days === 0) {
    const t = parts(date, timeZone, { hour: "2-digit", minute: "2-digit" });
    return `${t.hour}:${t.minute}`;
  }
  if (days === 1) return "ontem";
  const a = ymd(date, timeZone);
  if (a.y === ymd(now, timeZone).y) return `${pad(a.d)}/${pad(a.m)}`;
  return `${pad(a.d)}/${pad(a.m)}/${a.y}`;
}

export function formatDaySeparator(iso: string, now: Date, timeZone: string): string {
  const date = new Date(iso);
  const days = dayNumber(now, timeZone) - dayNumber(date, timeZone);
  if (days === 0) return "Hoje";
  if (days === 1) return "Ontem";
  const a = ymd(date, timeZone);
  return `${pad(a.d)}/${pad(a.m)}/${a.y}`;
}
