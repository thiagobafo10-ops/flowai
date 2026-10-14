"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClockIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import {
  enrollContactInSequence,
  fetchContactSequences,
  removeContactFromSequence,
} from "@/lib/growth/actions";
import { Button } from "@/components/ui/button";

const selectClass =
  "h-8 w-full rounded-md border border-input bg-background px-2 text-xs shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

export function ContactSequencesSection({
  orgId,
  contactId,
  canEdit,
}: {
  orgId: string;
  contactId: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [selectedSequenceId, setSelectedSequenceId] = useState("");

  const query = useQuery({
    queryKey: ["contact-sequences", orgId, contactId],
    queryFn: async () => {
      const res = await fetchContactSequences(contactId);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["contact-sequences", orgId, contactId] });

  async function handleEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSequenceId) return;

    startTransition(async () => {
      const res = await enrollContactInSequence({
        sequenceId: selectedSequenceId,
        contactId,
      });

      if (!res.ok) {
        toast.error(res.error);
        return;
      }

      if (res.data.enrollmentId === null) {
        toast.info("O contato já está inscrito nesta sequência.");
      } else {
        toast.success("Contato inscrito na sequência.");
      }
      setSelectedSequenceId("");
      refresh();
    });
  }

  async function handleRemove(sequenceId: string) {
    startTransition(async () => {
      const res = await removeContactFromSequence({
        sequenceId,
        contactId,
      });

      if (!res.ok) {
        toast.error(res.error);
        return;
      }

      toast.success("Contato removido da sequência.");
      refresh();
    });
  }

  if (query.isPending) {
    return (
      <section className="space-y-2 rounded-lg border p-3">
        <h3 className="font-medium text-sm">Sequências</h3>
        <div className="flex h-12 items-center justify-center">
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
        </div>
      </section>
    );
  }

  const { enrollments, availableSequences } = query.data ?? {
    enrollments: [],
    availableSequences: [],
  };

  return (
    <section className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">Sequências</h3>
        {enrollments.length > 0 && (
          <span className="text-xs text-muted-foreground font-semibold">
            {enrollments.length} ativa{enrollments.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {enrollments.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma sequência ativa para este contato.</p>
      ) : (
        <div className="space-y-2">
          {enrollments.map((enr) => (
            <div
              key={enr.id}
              className="flex items-center justify-between rounded-md border bg-muted/20 p-2 text-xs"
            >
              <div className="space-y-0.5">
                <span className="font-medium text-foreground">{enr.sequenceName}</span>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span>Passo {enr.currentPosition}</span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <ClockIcon className="size-3" />
                    {enr.nextSendAt
                      ? dateFormatter.format(new Date(enr.nextSendAt))
                      : "Aguardando envio"}
                  </span>
                </div>
              </div>

              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  disabled={pending}
                  onClick={() => handleRemove(enr.sequenceId)}
                  title="Remover da sequência"
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Seção de Inscrição */}
      {canEdit && availableSequences.length > 0 && (
        <form onSubmit={handleEnroll} className="space-y-2 pt-2 border-t">
          <div className="flex gap-1.5">
            <select
              value={selectedSequenceId}
              onChange={(e) => setSelectedSequenceId(e.target.value)}
              disabled={pending}
              className={selectClass}
            >
              <option value="">Selecione uma sequência...</option>
              {availableSequences.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <Button
              type="submit"
              size="xs"
              disabled={pending || !selectedSequenceId}
              className="gap-1 shrink-0"
            >
              {pending ? <Loader2Icon className="size-3 animate-spin" /> : <PlusIcon className="size-3" />}
              Inscrever
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
