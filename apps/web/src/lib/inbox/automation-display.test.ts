import { expect, test } from "vitest";
import { automationBanner, automationOptions, canStopAutomation } from "./automation-display";

const CTX = {
  automation: {
    runId: "00000000-0000-4000-8000-000000000001",
    nodeId: "00000000-0000-4000-8000-000000000002",
    buttons: [
      { id: "a1", title: "Quero", kind: "path" },
      { id: "u1", title: "Site", kind: "url", url: "https://exemplo.com.br/x" },
      { id: "u2", title: "Ruim", kind: "url", url: "javascript:alert(1)" },
    ],
    quickReplies: [{ id: "q1", title: "Sim" }],
  },
};
const msg = (senderType: string, context: unknown = CTX) => ({ senderType, context });

test("path buttons and quick replies are clickable only for agent+ on Simulator conversations", () => {
  const clickable = automationOptions(msg("automation"), { canWrite: true, channelType: "simulator" });
  expect(clickable).toEqual([
    { id: "a1", title: "Quero", mode: "click" },
    { id: "u1", title: "Site", mode: "link", url: "https://exemplo.com.br/x" },
    { id: "u2", title: "Ruim", mode: "readonly" },
    { id: "q1", title: "Sim", mode: "click" },
  ]);
  for (const [canWrite, channelType] of [[false, "simulator"], [true, "instagram"], [false, "instagram"]] as const) {
    const modes = automationOptions(msg("automation"), { canWrite, channelType }).map((o) => o.mode);
    expect(modes).toEqual(["readonly", "link", "readonly", "readonly"]);
  }
});

test("only automation messages with a well-formed context render options", () => {
  expect(automationOptions(msg("human"), { canWrite: true, channelType: "simulator" })).toEqual([]);
  expect(automationOptions(msg("automation", {}), { canWrite: true, channelType: "simulator" })).toEqual([]);
  expect(automationOptions(msg("automation", null), { canWrite: true, channelType: "simulator" })).toEqual([]);
  expect(automationOptions(msg("automation", { automation: { buttons: "x", quickReplies: [{ id: 1 }] } }), {
    canWrite: true, channelType: "simulator",
  })).toEqual([]);
});

test("header banner shows the automation name only for an active run", () => {
  for (const status of ["pending", "running", "waiting"]) {
    expect(automationBanner({ runId: "r", status, name: "Boas-vindas" })).toBe("Em automação: Boas-vindas");
  }
  for (const status of ["completed", "failed", "cancelled"]) {
    expect(automationBanner({ runId: "r", status, name: "Boas-vindas" })).toBeNull();
  }
  expect(automationBanner(null)).toBeNull();
});

test("stop button requires agent+ and an active run", () => {
  const run = { runId: "r", status: "waiting", name: "X" };
  expect(canStopAutomation({ canWrite: true, run })).toBe(true);
  expect(canStopAutomation({ canWrite: false, run })).toBe(false);
  expect(canStopAutomation({ canWrite: true, run: { ...run, status: "completed" } })).toBe(false);
  expect(canStopAutomation({ canWrite: true, run: null })).toBe(false);
});
