import type { SendWindow } from "./schemas.ts";

type Parts = { y: number; mo: number; d: number; h: number; mi: number; iso: number };

function localParts(ms: number, tz: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  const iso = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday!) + 1;
  return { y: +p.year!, mo: +p.month!, d: +p.day!, h: +p.hour!, mi: +p.minute!, iso };
}

/** Instante UTC (ms) em que o relógio local de `tz` marca a data/hora dadas. */
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess, tz);
    const shown = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    const next = guess + (wall - shown);
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

const toMinutes = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
const fmtIso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

/**
 * from + delay; se há janela e o resultado cai fora dela, vai para o próximo início permitido
 * no fuso informado (fim exclusivo; no máximo 8 dias à frente).
 */
export function nextSendTime(fromIso: string, delayMinutes: number, window: SendWindow | null, timeZone: string): string {
  const t = new Date(fromIso).getTime() + delayMinutes * 60_000;
  if (!window) return fmtIso(t);
  const start = toMinutes(window.start);
  const end = toMinutes(window.end);
  const lp = localParts(t, timeZone);
  const minutes = lp.h * 60 + lp.mi;
  if (window.days.includes(lp.iso) && minutes >= start && minutes < end) return fmtIso(t);
  for (let k = 0; k <= 8; k++) {
    const day = new Date(Date.UTC(lp.y, lp.mo - 1, lp.d + k));
    const iso = ((day.getUTCDay() + 6) % 7) + 1;
    if (!window.days.includes(iso)) continue;
    if (k === 0 && minutes >= start) continue; // hoje já passou do início
    return fmtIso(
      zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), Math.floor(start / 60), start % 60, timeZone),
    );
  }
  return fmtIso(t);
}
