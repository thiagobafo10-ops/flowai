import { expect, test, vi } from "vitest";
vi.mock("@/lib/org/active-org", () => ({ getActiveOrg: vi.fn(() => { throw new Error("Unexpected authoring"); }) }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn(() => { throw new Error("Unexpected database write"); }) }));
import { saveCommentRule, setCommentRuleActive } from "./actions";

test("legacy comment actions return the exact automation notice without authoring", async () => {
  const notice = { ok: false, error: "As regras de comentário agora são automações." };
  expect(await saveCommentRule({ channelId: "legacy", keyword: "guia", active: true })).toEqual(notice);
  expect(await setCommentRuleActive("legacy", false)).toEqual(notice);
});
