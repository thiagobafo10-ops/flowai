import { expect, it } from "vitest";
import { InstagramProvider } from "./provider.ts";

it("publishes a public comment reply through the official replies edge", async () => {
  let sent: { url: string; body: unknown } | undefined;
  const provider = new InstagramProvider({ accountId: "789", accessToken: "test-token", apiVersion: "v26.0", now: () => new Date(), fetch: async (url, init) => {
    sent = { url: String(url), body: JSON.parse(String(init?.body)) };
    return Response.json({ id: "reply-123" });
  } });
  expect(await provider.sendPublicReply("123", "Convite VIP")).toEqual({ externalId: "reply-123" });
  expect(sent).toEqual({ url: "https://graph.instagram.com/v26.0/123/replies", body: { message: "Convite VIP" } });
});
it("treats a successful public POST with no reply ID as uncertain", async () => {
  const provider = new InstagramProvider({ accountId: "789", accessToken: "test-token", apiVersion: "v26.0", now: () => new Date(), fetch: async () => Response.json({ success: true }) });
  await expect(provider.sendPublicReply("123", "Convite")).rejects.toMatchObject({ certainty: "uncertain" });
});

