"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const busy = saving || refreshing;
  const [picking, setPicking] = useState(false);
  const [allTags, setAllTags] = useState(initialAll);
  const [error, setError] = useState<string | null>(null);
  // Estado local (otimista), ressincronizado quando o servidor devolve as tags — mas não no
  // meio de uma gravação, para não desfazer cliques ainda na fila.
  const propIds = tags.map((t) => t.id);
  const propKey = propIds.join(",");
  const [seenKey, setSeenKey] = useState(propKey);
  const [selected, setSelected] = useState(propIds);
  if (seenKey !== propKey && !busy) {
    setSeenKey(propKey);
    setSelected(propIds);
  }
  // Conjunto mais recente (lido por callbacks assíncronos, ex.: tag criada no seletor).
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  });
  // Fila: só o último conjunto desejado é gravado; gravações nunca correm em paralelo.
  const queue = useRef<{ running: boolean; next: string[] | null }>({ running: false, next: null });

  const tagById = new Map(allTags.map((t) => [t.id, t]));
  const shown = selected.flatMap((id) => {
    const t = tagById.get(id);
    return t ? [t] : [];
  });

  function update(ids: string[]) {
    const q = queue.current;
    setError(null);
    const before = selectedRef.current;
    selectedRef.current = ids;
    setSelected(ids);
    q.next = ids;
    if (q.running) return;
    q.running = true;
    setSaving(true);
    void (async () => {
      let lastSaved = before;
      while (q.next) {
        const next = q.next;
        q.next = null;
        const result = await setContactTags(contactId, next);
        if (!result.ok) {
          q.next = null;
          selectedRef.current = lastSaved;
          setSelected(lastSaved);
          setError(result.error);
          toast.error(result.error);
          break;
        }
        lastSaved = next;
      }
      q.running = false;
      setSaving(false);
      startRefresh(() => router.refresh());
    })();
  }

  return (
    <Card role="region" aria-label="Tags" aria-busy={busy}>
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
                  onClick={() => update(selectedRef.current.filter((id) => id !== t.id))}
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
                createDisabled={saving}
                onChange={update}
                onCreated={(t) => {
                  setAllTags((prev) => (prev.some((p) => p.id === t.id) ? prev : [...prev, t]));
                  if (!selectedRef.current.includes(t.id)) update([...selectedRef.current, t.id]);
                }}
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
