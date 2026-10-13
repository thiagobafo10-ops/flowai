"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { InstagramConnectionView } from "@/lib/instagram/queries";
import { InstagramConnectionForm } from "./connection-form";
import { InstagramConnectionCard } from "./connection-card";
import { InstagramCommentRules } from "./comment-rules";
export function InstagramSettings({ connections }: { connections: InstagramConnectionView[] }) {
  const router = useRouter(); const [adding, setAdding] = useState(false); const [editing, setEditing] = useState<InstagramConnectionView | null>(null);
  return <section aria-labelledby="instagram-heading" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="instagram-heading" className="text-lg font-medium">Instagram</h2>{connections.length > 0 && !adding && !editing && <Button variant="outline" onClick={() => setAdding(true)}>Adicionar conta Instagram</Button>}</div>
    {(connections.length === 0 || adding || editing) && <InstagramConnectionForm key={editing?.id ?? "new"} initial={editing ?? undefined} onSaved={() => { setAdding(false); setEditing(null); router.refresh(); }} onCancel={connections.length ? () => { setAdding(false); setEditing(null); } : undefined} />}
    {connections.map((connection) => <div key={connection.id} className="space-y-3"><InstagramConnectionCard connection={connection} onChanged={() => router.refresh()} onEdit={() => { setAdding(false); setEditing(connection); }} /></div>)}
    {connections.length > 0 && <InstagramCommentRules />}
  </section>;
}
