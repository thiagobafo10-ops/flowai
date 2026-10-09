import { describe, it, expect } from "vitest";
import { resolveActiveOrg } from "./resolve-active-org.ts";

const m = (id: string, createdAt: string) => ({ organizationId: id, createdAt });

describe("resolveActiveOrg", () => {
  it("usa o cookie quando o usuário é membro da org", () => {
    expect(resolveActiveOrg("b", [m("a", "2026-01-01"), m("b", "2026-02-01")])).toBe("b");
  });
  it("ignora cookie de org da qual o usuário não é membro e cai na mais antiga", () => {
    expect(resolveActiveOrg("x", [m("b", "2026-02-01"), m("a", "2026-01-01")])).toBe("a");
  });
  it("sem cookie, usa a membership mais antiga", () => {
    expect(resolveActiveOrg(null, [m("b", "2026-02-01"), m("a", "2026-01-01")])).toBe("a");
  });
  it("sem memberships retorna null", () => {
    expect(resolveActiveOrg("a", [])).toBeNull();
  });
});
