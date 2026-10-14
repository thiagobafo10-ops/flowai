import { describe, expect, it } from "vitest";
import { formatAudiencePreview, parseScheduleToUtc } from "./campaign-schedule";
import { growthError } from "./messages";

describe("formatAudiencePreview", () => {
  it("formata contadores singulares e plurais corretamente", () => {
    expect(
      formatAudiencePreview({ total: 10, inWindow: 7, outOfWindow: 3 }),
    ).toBe("10 no público · 7 dentro da janela de 24h · 3 ficarão de fora");

    expect(
      formatAudiencePreview({ total: 1, inWindow: 1, outOfWindow: 0 }),
    ).toBe("1 no público · 1 dentro da janela de 24h · 0 ficarão de fora");

    expect(
      formatAudiencePreview({ total: 1, inWindow: 0, outOfWindow: 1 }),
    ).toBe("1 no público · 0 dentro da janela de 24h · 1 ficará de fora");
  });
});

describe("parseScheduleToUtc", () => {
  it("converte data e hora de America/Sao_Paulo (UTC-3) para UTC", () => {
    // 2026-10-20 14:30 em Brasília (UTC-3) -> 17:30 UTC
    const utcIso = parseScheduleToUtc("2026-10-20", "14:30", "America/Sao_Paulo");
    const d = new Date(utcIso);
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(9); // 0-indexed, outubro é 9
    expect(d.getUTCDate()).toBe(20);
    expect(d.getUTCHours()).toBe(17);
    expect(d.getUTCMinutes()).toBe(30);
  });

  it("lança erro se campos estiverem vazios", () => {
    expect(() => parseScheduleToUtc("", "14:30")).toThrow();
    expect(() => parseScheduleToUtc("2026-10-20", "")).toThrow();
  });
});

describe("growthError para campanhas", () => {
  it("mapeia erros específicos de campanha", () => {
    expect(growthError({ code: "22023", message: "campaign_not_draft" })).toBe(
      "A campanha já foi agendada ou enviada.",
    );
    expect(growthError({ code: "22023", message: "invalid_audience" })).toBe(
      "Revise os filtros do público selecionado.",
    );
    expect(growthError({ code: "22023", message: "invalid_message" })).toBe(
      "Revise a mensagem configurada.",
    );
  });
});
