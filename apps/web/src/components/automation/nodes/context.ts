"use client";

import { createContext, useContext } from "react";
import type { GraphIssue, TriggerType } from "@flowai/core";
import type { EditorRefs } from "@/lib/automation/queries";

export type EditorContextValue = {
  refs: EditorRefs;
  issuesByNode: Map<string, GraphIssue[]>;
  triggerType: TriggerType;
  triggerConfig: unknown;
};

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditorContext(): EditorContextValue {
  const value = useContext(EditorContext);
  if (!value) throw new Error("EditorContext ausente");
  return value;
}
