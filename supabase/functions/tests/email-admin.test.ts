import { handleEmailAdmin, type EmailAdminDeps } from "../email-admin/handler.ts";

function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }

const ORG = "00000000-0000-4000-8000-000000000010";
const STEP = "00000000-0000-4000-8000-000000000020";
function fixture(reply: () => Response) {
  const statuses: unknown[][] = [];
  const calls: { url: string; init: RequestInit }[] = [];
  const deps: EmailAdminDeps = {
    authorize: async () => ({ userId: "user-1" }),
    readUser: async () => ({ email: "admin@example.com", name: "Bia Admin" }),
    readStep: async (_request, org, step) => org === ORG && step === STEP
      ? { subject: "Seu carrinho, {primeiro_nome}", heading: "Volte", body: "Corpo", buttonLabel: "Ir", coupon: null } : null,
    readSettings: async () => ({ resendKey: "re_key", fromName: "Loja X", fromEmail: "contato@loja.example", replyTo: null }),
    recordDomainStatus: async (...args) => { statuses.push(args); },
    fetch: async (input, init) => { calls.push({ url: String(input), init: init ?? {} }); return reply(); },
  };
  return { deps, statuses, calls };
}
const req = (body: unknown) => new Request("http://local/email-admin", { method: "POST", headers: { Authorization: "Bearer jwt" }, body: JSON.stringify(body) });

Deno.test("non-admins are forbidden", async () => {
  const f = fixture(() => Response.json({}));
  f.deps.authorize = async () => null;
  const response = await handleEmailAdmin(req({ action: "test", organizationId: ORG, stepId: STEP }), f.deps);
  assert(response.status === 403 && f.calls.length === 0);
});

Deno.test("test sends the step to the logged-in user's e-mail with the step subject", async () => {
  const f = fixture(() => Response.json({ id: "r1" }));
  const response = await handleEmailAdmin(req({ action: "test", organizationId: ORG, stepId: STEP }), f.deps);
  assert(response.status === 200, String(response.status));
  assert(f.calls.length === 1 && f.calls[0]!.url === "https://api.resend.com/emails");
  const body = JSON.parse(String(f.calls[0]!.init.body));
  assert(body.to[0] === "admin@example.com" && body.from === "Loja X <contato@loja.example>");
  assert(body.subject === "Seu carrinho, Bia", body.subject);
  assert(new Headers(f.calls[0]!.init.headers).get("authorization") === "Bearer re_key");
  const missing = await handleEmailAdmin(req({ action: "test", organizationId: ORG, stepId: "00000000-0000-4000-8000-000000000099" }), f.deps);
  assert(missing.status === 404);
});

Deno.test("verify_domain records verified, pending, failed and not_found", async () => {
  for (const [resendStatus, expected] of [["verified", "verified"], ["not_started", "pending"], ["failed", "failed"]]) {
    const f = fixture(() => Response.json({ data: [{ name: "outra.example", status: "verified" }, { name: "loja.example", status: resendStatus }] }));
    const response = await handleEmailAdmin(req({ action: "verify_domain", organizationId: ORG }), f.deps);
    assert(response.status === 200);
    assert(f.calls[0]!.url === "https://api.resend.com/domains" && (f.calls[0]!.init.method ?? "GET") === "GET");
    assert(JSON.stringify(f.statuses) === JSON.stringify([[ORG, expected]]), JSON.stringify(f.statuses));
    assert((await response.json()).status === expected);
  }
  const absent = fixture(() => Response.json({ data: [] }));
  await handleEmailAdmin(req({ action: "verify_domain", organizationId: ORG }), absent.deps);
  assert(absent.statuses[0]![1] === "not_found");
});
