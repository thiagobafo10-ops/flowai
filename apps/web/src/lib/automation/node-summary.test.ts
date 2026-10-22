import { expect, test } from "vitest";
import { triggerSummary } from "./node-summary";

const refs = { tags: [], stages: [], members: [], channels: [{ id: "ch", name: "@empresa", type: "instagram" }], entryLinks: [], sequences: [] };
const base = { channelId: "ch", mediaId: null, anyKeyword: true, keywords: [], mode: "any" };

test("gatilho de comentário menciona a resposta pública quando ligada", () => {
  expect(triggerSummary("instagram_comment", { ...base, publicReplies: ["Te mandei no Direct!"] }, refs)).toContain("+ resposta pública");
});

test("gatilho de comentário sem variações não menciona resposta pública", () => {
  expect(triggerSummary("instagram_comment", { ...base, publicReplies: [] }, refs)).not.toContain("+ resposta pública");
  expect(triggerSummary("instagram_comment", base, refs)).not.toContain("+ resposta pública");
});
