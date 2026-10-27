import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it.each([
    ["/oauth/consent?authorization_id=abc", "/oauth/consent?authorization_id=abc"],
    ["/dashboard", "/dashboard"],
  ])("accepts same-origin path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    undefined, null, "", "dashboard", "//evil.com", "/\\evil.com", "https://evil.com",
    "javascript:alert(1)", "/ok\nLocation: x", ["/a", "/b"],
  ])("rejects unsafe value %j", (input) => {
    expect(safeNextPath(input as never)).toBeNull();
  });
});
