"use client";

import { useState, useTransition } from "react";
import type { TagColor } from "@flowai/core";
import { toast } from "sonner";
import { createTagInline } from "@/lib/crm/contact-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TAG_COLOR_CLASSES } from "./tag-badge";

export type PickerTag = { id: string; name: string; color: TagColor };

type Props = {
  tags: PickerTag[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /**
   * Chamado quando uma tag é criada na hora: o pai a inclui na lista e a marca, a partir do
   * conjunto mais recente (não do `selected` de quando a criação começou).
   */
  onCreated: (tag: PickerTag) => void;
  /** Desabilita criar tag (ex.: o pai ainda grava a seleção anterior). */
  createDisabled?: boolean;
};

export function TagPicker({ tags, selected, onChange, onCreated, createDisabled }: Props) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((t) => t !== id) : [...selected, id]);
  }

  function create() {
    const value = name.trim();
    if (!value || pending || createDisabled) return;
    setError(null);
    startTransition(async () => {
      const result = await createTagInline(value);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      onCreated(result.data);
      setName("");
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tags">
        {tags.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma tag criada.</p>}
        {tags.map((t) => {
          const on = selected.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(t.id)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium outline-none ring-offset-1 focus-visible:ring-2 focus-visible:ring-ring",
                on ? TAG_COLOR_CLASSES[t.color] : "bg-transparent text-muted-foreground ring-1 ring-border",
                on && "ring-2 ring-foreground/40",
              )}
            >
              {t.name}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <Input
          aria-label="Nova tag"
          placeholder="Nova tag"
          value={name}
          maxLength={40}
          disabled={createDisabled}
          aria-invalid={!!error}
          aria-describedby={error ? "new-tag-error" : undefined}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              create();
            }
          }}
        />
        <Button type="button" variant="outline" disabled={pending || createDisabled || !name.trim()} onClick={create}>
          Criar tag
        </Button>
      </div>
      {error && (
        <p id="new-tag-error" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
