/** Normalizes a Brazilian phone to E.164 (+55 + DDD + number), or null if invalid. */
export function normalizeBrazilianPhone(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  if (digits.length !== 10 && digits.length !== 11) return null;
  const ddd = Number(digits.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;
  return `+55${digits}`;
}

/** Formats an E.164 Brazilian phone as "(11) 99999-8888". Unknown shapes are returned unchanged. */
export function formatBrazilianPhone(e164: string): string {
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  if (!m) return e164;
  return `(${m[1]}) ${m[2]}-${m[3]}`;
}
