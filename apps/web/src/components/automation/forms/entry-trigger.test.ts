import { expect, test } from "vitest";
import { triggerToConfig, triggerToValues } from "./mappings";
import { defaultTriggerConfig } from "@/lib/automation/node-labels";
test("o gatilho de link preserva a seleção múltipla ao abrir e salvar", () => {
  const values = triggerToValues({ linkIds: ["one", "two"] });
  expect(triggerToConfig("entry_link", values)).toEqual({ linkIds: ["one", "two"] });
});
test("um gatilho novo de link inicia com seleção vazia validável", () => {
  expect(defaultTriggerConfig("entry_link", null)).toEqual({ linkIds: [] });
});
