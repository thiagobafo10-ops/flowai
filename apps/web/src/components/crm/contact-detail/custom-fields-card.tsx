"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveCustomFields } from "@/lib/crm/contact-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Field = { key: string; value: string };
type Props = { contactId: string; fields: Field[]; canEdit: boolean };

export function CustomFieldsCard({ contactId, fields, canEdit }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  function persist(next: Field[], onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await saveCustomFields(contactId, next);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  function add() {
    const k = key.trim();
    if (!k) {
      setError("Informe o nome do campo.");
      return;
    }
    if (fields.some((f) => f.key.toLowerCase() === k.toLowerCase())) {
      setError("Nomes de campos repetidos.");
      return;
    }
    persist([...fields, { key: k, value: value.trim() }], () => {
      setKey("");
      setValue("");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Campos personalizados</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {fields.length === 0 && <p className="text-sm text-muted-foreground">Nenhum campo personalizado.</p>}
        <ul className="space-y-2 text-sm">
          {fields.map((f) => (
            <li key={f.key} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{f.key}</span>
              {editing === f.key ? (
                <>
                  <Input
                    aria-label={`Valor de ${f.key}`}
                    className="h-8 w-48"
                    maxLength={500}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      persist(
                        fields.map((x) => (x.key === f.key ? { key: f.key, value: editValue.trim() } : x)),
                        () => setEditing(null),
                      )
                    }
                  >
                    Salvar
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)}>
                    Cancelar
                  </Button>
                </>
              ) : (
                <>
                  <span className="break-words text-muted-foreground">{f.value || "—"}</span>
                  {canEdit && (
                    <span className="ml-auto flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Editar campo ${f.key}`}
                        onClick={() => {
                          setEditing(f.key);
                          setEditValue(f.value);
                        }}
                      >
                        Editar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Remover campo ${f.key}`}
                        disabled={pending}
                        onClick={() => persist(fields.filter((x) => x.key !== f.key))}
                      >
                        Remover
                      </Button>
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="cf-key">Nome do campo</Label>
              <Input id="cf-key" maxLength={60} value={key} onChange={(e) => setKey(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cf-value">Valor</Label>
              <Input id="cf-value" maxLength={500} value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <Button type="submit" variant="outline" disabled={pending}>
              Adicionar campo
            </Button>
          </form>
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
