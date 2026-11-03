import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: state.rpc }) }));
import { unsubscribe } from "./actions";
import { POST } from "./one-click/route";

const TOKEN = "a".repeat(48);
beforeEach(() => { state.rpc.mockReset(); vi.spyOn(console, "error").mockImplementation(() => {}); });

test("unsubscribe with an unknown token shows 'Link inválido'", async () => {
  state.rpc.mockResolvedValue({ data: false, error: null });
  expect(await unsubscribe(TOKEN)).toBe("Link inválido");
  expect(state.rpc).toHaveBeenCalledWith("unsubscribe_email", { p_token: TOKEN });
});

test("unsubscribe with a malformed token never calls the database", async () => {
  expect(await unsubscribe("../x")).toBe("Link inválido");
  expect(state.rpc).not.toHaveBeenCalled();
});

test("unsubscribe confirms a known token", async () => {
  state.rpc.mockResolvedValue({ data: true, error: null });
  expect(await unsubscribe(TOKEN)).toBe("Descadastro confirmado");
});

test.each([
  ["known", { data: true, error: null }],
  ["unknown", { data: false, error: null }],
  ["failing", { data: null, error: { code: "XX" } }],
])("one-click POST answers 200 without detail for a %s token", async (_label, result) => {
  state.rpc.mockResolvedValue(result);
  const response = await POST(new Request("http://localhost/e/sair/x/one-click", { method: "POST" }), { params: Promise.resolve({ token: TOKEN }) });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("");
});
