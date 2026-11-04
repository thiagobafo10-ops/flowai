"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { savePermission } from "@/lib/carts/actions";
import { useRun } from "./use-run";

/** Nunca pré-preenchido: o operador informa a evidência que tem. */
export function PermissionDialog({ contactId }: { contactId: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"granted" | "revoked" | "">("");
  const [source, setSource] = useState("");
  const [at, setAt] = useState("");
  const { pending, error, setError, run } = useRun();
  function reset(o: boolean) {
    setOpen(o);
    if (!o) { setStatus(""); setSource(""); setAt(""); setError(null); }
  }
  return (
    <>
      <Button variant="outline" onClick={() => reset(true)}>Autorização de contato</Button>
      <Dialog open={open} onOpenChange={reset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Autorização de contato (WhatsApp)</DialogTitle>
            <DialogDescription>Registre a autorização ou a revogação que o cliente deu, com a origem e a data da evidência.</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            if (!status) { setError("Escolha a situação da autorização."); return; }
            const iso = at ? new Date(at).toISOString() : "";
            run("permission", () => savePermission(contactId, status, source, iso), () => { toast.success("Autorização registrada."); reset(false); });
          }}>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Situação</legend>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="radio" name="perm-status" checked={status === "granted"} onChange={() => setStatus("granted")} /> Autorizado</label>
                <label className="flex items-center gap-2"><input type="radio" name="perm-status" checked={status === "revoked"} onChange={() => setStatus("revoked")} /> Revogado</label>
              </div>
            </fieldset>
            <div className="space-y-1">
              <Label htmlFor="perm-source">Origem</Label>
              <Input id="perm-source" value={source} onChange={(e) => setSource(e.target.value)} maxLength={240} placeholder="Ex.: pediu pelo Instagram" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="perm-at">Data da evidência</Label>
              <Input id="perm-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} required />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Registrar"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
