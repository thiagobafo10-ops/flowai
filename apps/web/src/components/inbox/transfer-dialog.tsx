"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { MemberOption } from "@/lib/crm/queries";

export function TransferDialog({ open, onOpenChange, members, assignedTo, busy, onTransfer }: {
  open: boolean; onOpenChange: (value: boolean) => void; members: MemberOption[]; assignedTo: string | null; busy: boolean;
  onTransfer: (userId: string | null, note: string) => Promise<boolean>;
}) {
  const [userId, setUserId] = useState(assignedTo ?? "");
  const [note, setNote] = useState("");
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Transferir conversa</DialogTitle><DialogDescription>Escolha o responsável e inclua uma nota interna, se necessário.</DialogDescription></DialogHeader>
    <form className="space-y-4" onSubmit={async (event) => { event.preventDefault(); if (await onTransfer(userId || null, note)) onOpenChange(false); }}>
      <div className="space-y-1"><Label htmlFor="transfer-member">Responsável</Label><select id="transfer-member" className="h-9 w-full rounded-lg border bg-background px-2 text-sm" value={userId} disabled={busy} onChange={(event) => setUserId(event.target.value)}><option value="">Sem responsável</option>{members.map((member) => <option value={member.userId} key={member.userId}>{member.name}</option>)}</select></div>
      <div className="space-y-1"><Label htmlFor="transfer-note">Nota (opcional)</Label><textarea id="transfer-note" rows={3} className="w-full rounded-lg border p-2 text-sm" value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} /></div>
      <Button type="submit" disabled={busy}>Transferir</Button>
    </form>
  </DialogContent></Dialog>;
}
