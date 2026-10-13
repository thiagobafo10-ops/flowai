import { expect, test } from "vitest";
import { QueryClient, matchQuery } from "@tanstack/react-query";
import { editLoaderView, knowledgeDocumentKey } from "./document-loader";

test("com dados carregados mostra o formulário mesmo se um refetch falhar", () => {
  expect(editLoaderView({ data: { title: "t", content: "c" }, isError: true })).toBe("form");
  expect(editLoaderView({ data: { title: "t", content: "c" }, isError: false })).toBe("form");
});
test("sem dados: erro ou carregando", () => {
  expect(editLoaderView({ data: undefined, isError: true })).toBe("error");
  expect(editLoaderView({ data: undefined, isError: false })).toBe("loading");
});
test("a chave do documento fica fora do prefixo ['knowledge']", () => {
  const client = new QueryClient();
  client.setQueryData(knowledgeDocumentKey("org", "doc"), { title: "t" });
  const query = client.getQueryCache().find({ queryKey: knowledgeDocumentKey("org", "doc") })!;
  expect(matchQuery({ queryKey: ["knowledge"] }, query)).toBe(false);
  expect(matchQuery({ queryKey: ["knowledge", "org"] }, query)).toBe(false);
});
