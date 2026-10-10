import { expect, it } from "vitest";
import { TAG_COLORS, tagSchema } from "./tag.ts";

it("validates tags", () => {
  expect(TAG_COLORS).toHaveLength(8);
  expect(tagSchema.parse({ name: "  VIP " })).toEqual({ name: "VIP", color: "slate" });
  expect(tagSchema.parse({ name: "a", color: "pink" }).color).toBe("pink");
  expect(tagSchema.safeParse({ name: " " }).success).toBe(false);
  expect(tagSchema.safeParse({ name: "a".repeat(41) }).success).toBe(false);
  expect(tagSchema.safeParse({ name: "a", color: "neon" }).success).toBe(false);
});
