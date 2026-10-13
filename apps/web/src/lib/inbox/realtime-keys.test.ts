import { expect, test } from "vitest";
import { realtimeInvalidations } from "./realtime-keys";

test("mensagens e conversas invalidam só as consultas do Inbox", () => {
  for (const table of ["messages", "conversations"] as const) {
    const keys = realtimeInvalidations(table, "org");
    expect(keys).toEqual([["inbox", "org"], ["conversation", "org"], ["unread", "org"], ["inbox-contact", "org"]]);
  }
});
test("documentos invalidam só a base de conhecimento", () => {
  expect(realtimeInvalidations("knowledge_documents", "org")).toEqual([["knowledge", "org"]]);
});
