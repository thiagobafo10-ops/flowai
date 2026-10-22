"use client";

import { Controller, type Control, type FieldErrors } from "react-hook-form";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { PUBLIC_REPLY_MAX_ITEMS, PUBLIC_REPLY_MAX_LENGTH } from "@flowai/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorAt, invalidProps } from "./fields";
import type { TriggerValues } from "./mappings";

/** Gatilho de comentário: resposta pública opcional, sorteada entre as variações a cada comentário. */
export function PublicRepliesField({ control, errors, enabled, onToggle }: {
  control: Control<TriggerValues>;
  errors: FieldErrors<TriggerValues>;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div className="pt-1 space-y-2">
      <label htmlFor="trigger-public-reply" className="flex items-center gap-2 text-sm font-medium cursor-pointer">
        <input id="trigger-public-reply" type="checkbox" role="switch" className="size-4" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        <span>Responder publicamente ao comentário</span>
      </label>
      {enabled && (
        <Controller
          control={control}
          name="publicReplies"
          render={({ field }) => {
            const list = field.value ?? [];
            const update = (next: string[]) => field.onChange(next);
            return (
              <div className="ml-6 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Uma variação é sorteada a cada comentário. Variar o texto reduz o risco de o Instagram tratar as respostas como spam.
                </p>
                {list.map((text, i) => {
                  const id = `trigger-public-reply-${i}`;
                  const error = errorAt(errors, `publicReplies.${i}`);
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Input
                          id={id}
                          aria-label={`Variação ${i + 1}`}
                          value={text}
                          maxLength={PUBLIC_REPLY_MAX_LENGTH}
                          onChange={(e) => update(list.map((t, j) => (j === i ? e.target.value : t)))}
                          onBlur={field.onBlur}
                          {...invalidProps(id, error)}
                        />
                        <Button type="button" variant="ghost" size="icon" aria-label={`Remover variação ${i + 1}`} onClick={() => update(list.filter((_, j) => j !== i))}>
                          <Trash2Icon />
                        </Button>
                      </div>
                      <div className="flex justify-between text-[11px] text-muted-foreground">
                        <span id={`${id}-error`} className="text-destructive">{error}</span>
                        <span>{text.length}/{PUBLIC_REPLY_MAX_LENGTH}</span>
                      </div>
                    </div>
                  );
                })}
                {errorAt(errors, "publicReplies") && <p className="text-xs text-destructive">{errorAt(errors, "publicReplies")}</p>}
                <Button type="button" variant="outline" size="sm" disabled={list.length >= PUBLIC_REPLY_MAX_ITEMS} onClick={() => update([...list, ""])}>
                  <PlusIcon /> Adicionar variação
                </Button>
              </div>
            );
          }}
        />
      )}
    </div>
  );
}
