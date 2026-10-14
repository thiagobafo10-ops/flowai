export function formatAudiencePreview(counts: { total: number; inWindow: number; outOfWindow: number }): string {
  const { total, inWindow, outOfWindow } = counts;
  const totalStr = total === 1 ? "1 no público" : `${total} no público`;
  const windowStr = inWindow === 1 ? "1 dentro da janela de 24h" : `${inWindow} dentro da janela de 24h`;
  const outStr = outOfWindow === 1 ? "1 ficará de fora" : `${outOfWindow} ficarão de fora`;
  return `${totalStr} · ${windowStr} · ${outStr}`;
}

/**
 * Converte data (YYYY-MM-DD) e hora (HH:mm) para string ISO UTC.
 * Caso nenhum fuso seja fornecido, assume o fuso do ambiente ou local.
 */
export function parseScheduleToUtc(date: string, time: string, timeZone = "America/Sao_Paulo"): string {
  if (!date || !time) throw new Error("Data e hora são obrigatórias.");
  
  // Cria representação local no formato ISO e ajusta pelo timezone
  const dateStr = `${date}T${time}:00`;
  
  // Cria uma data com base no offset do fuso especificado
  // Para compatibilidade sólida em ambientes Node/V8 com Intl:
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  // Aproximação robusta de offset usando data de referência
  const naive = new Date(dateStr + "Z");
  if (isNaN(naive.getTime())) throw new Error("Data ou hora inválida.");

  // Calcula o offset exato do fuso horário na data especificada
  const parts = formatter.formatToParts(naive);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const asInTz = new Date(
    Date.UTC(
      Number(getPart("year")),
      Number(getPart("month")) - 1,
      Number(getPart("day")),
      Number(getPart("hour")),
      Number(getPart("minute")),
      Number(getPart("second")),
    ),
  );
  const offsetMs = asInTz.getTime() - naive.getTime();
  
  const targetUtcMs = naive.getTime() - offsetMs;
  return new Date(targetUtcMs).toISOString();
}
