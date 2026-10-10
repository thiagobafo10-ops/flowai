"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { XIcon } from "lucide-react";
import { toast } from "sonner";
import { setContactTags } from "@/lib/crm/contact-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TagBadge } from "../tag-badge";
import { TagPicker, type PickerTag } from "../tag-picker";

type Props = {
  contactId: string;
  tags: PickerTag[];
  allTags: PickerTag[];
  canEdit: boolean;
};

export function TagsCard({ contactId, tags, allTags: initialAll, canEdit }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picking, setPicking] = useState(false);
  const [allTags, setAllTags] = useState(initialAll);
  const [error, setError] = useState<string | null>(null);
  // Estado local (otimista), ressincronizado quando o servidor devolve as tags.
  const propIds = tags.map((t) => t.id);
  const propKey = propIds.join(",");
  const [seenKey, setSeenKey] = useState(propKey);
  const [selected, setSelected] = useState(propIds);
  if (seenKey !== propKey) {
    setSeenKey(propKey);
    setSelected(propIds);
  }
  const tagById = new Map(allTags.map((t) => [t.id, t]));
  const shown = selected.flatMap((id) => {
    const t = tagById.get(id);
    return t ? [t] : [];
  });

  function update(ids: string[]) {
    if (pending) return;
    const previous = selected;
    setError(null);
    setSelected(ids);
    startTransition(async () => {
      const result = await setContactTags(contactId, ids);
      if (!result.ok) {
        setSelected(previous);
        setError(result.error);
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card role="region" aria-label="Tags" aria-busy={pending}>
      <CardHeader>
        <CardTitle>Tags</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="flex flex-wrap gap-1.5" aria-label="Tags do contato">
          {shown.length === 0 && <li className="text-sm text-muted-foreground">Nenhuma tag.</li>}
          {shown.map((t) => (
            <li key={t.id} className="inline-flex items-center gap-0.5">
              <TagBadge name={t.name} color={t.color} />
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Remover tag ${t.name}`}
                  disabled={pending}
                  onClick={() => update(selected.filter((id) => id !== t.id))}
                  className="rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <XIcon className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <>
            <Button type="button" variant="outline" size="sm" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
              Adicionar tag
            </Button>
            {picking && (
              <TagPicker
                tags={allTags}
                selected={selected}
                disabled={pending}
                onChange={update}
                onCreated={(t) => setAllTags((prev) => (prev.some((p) => p.id === t.id) ? prev : [...prev, t]))}
              />
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
