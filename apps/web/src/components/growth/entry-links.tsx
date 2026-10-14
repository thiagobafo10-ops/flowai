"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  CopyIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  WorkflowIcon,
} from "lucide-react";
import { toast } from "sonner";
import { archiveEntryLink, saveEntryLink } from "@/lib/growth/actions";
import { copyEntryLink } from "@/lib/growth/export";
import { INSTAGRAM_USERNAME_REQUIRED } from "@/lib/growth/messages";
import type {
  EntryLinkItem,
  EntryLinksPayload,
  GrowthChannel,
  GrowthTag,
} from "@/lib/growth/queries";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QrDownloadDialog } from "./qr-download";

type ApiData = EntryLinksPayload & { canWrite: boolean; canSimulate: boolean };

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

async function fetchLinks(): Promise<ApiData> {
  const res = await fetch("/api/links", { cache: "no-store" });
  if (!res.ok) throw new Error("Não foi possível carregar os links.");
  return res.json() as Promise<ApiData>;
}

export function EntryLinksView({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["entry-links", orgId], queryFn: fetchLinks });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<EntryLinkItem | null>(null);

  const [archivingLink, setArchivingLink] = useState<EntryLinkItem | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["entry-links", orgId] });

  if (query.isPending) {
    return (
      <div aria-busy="true" aria-label="Carregando links" className="space-y-3">
        <div className="h-8 animate-pulse rounded-lg bg-muted" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/60" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border p-6">
        <p className="text-sm text-destructive">Não foi possível carregar os links de entrada.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const { links, channels, tags, canWrite } = query.data;

  async function handleArchive(link: EntryLinkItem) {
    startTransition(async () => {
      const result = await archiveEntryLink(link.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Link arquivado.");
      setArchivingLink(null);
      refresh();
    });
  }

  async function handleCopy(url: string) {
    try {
      await copyEntryLink(url);
      toast.success("Link copiado para a área de transferência.");
    } catch {
      toast.error("Não foi possível copiar o link.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <h2 className="text-lg font-medium">Links de entrada</h2>
          <p className="text-sm text-muted-foreground">
            Links diretos e QR codes do Instagram ou Simulador que iniciam automações e aplicam tags.
          </p>
        </div>
        {canWrite && (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setEditingLink(null);
              setDialogOpen(true);
            }}
            className="gap-1.5"
          >
            <PlusIcon className="size-4" />
            Novo link
          </Button>
        )}
      </div>

      {links.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm font-medium">Nenhum link de entrada criado.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Crie links para divulgar em campanhas, bios, stories ou materiais impressos com QR code.
          </p>
          {canWrite && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4 gap-1.5"
              onClick={() => {
                setEditingLink(null);
                setDialogOpen(true);
              }}
            >
              <PlusIcon className="size-4" />
              Criar primeiro link
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Nome / Canal</th>
                <th className="px-4 py-3 font-medium">Link & Código</th>
                <th className="px-4 py-3 font-medium">Usos (Total / 7d)</th>
                <th className="px-4 py-3 font-medium">Automação ligada</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {links.map((link) => {
                const isInstagram = link.channel?.type === "instagram";
                const missingUsername = isInstagram && !link.channel?.instagram_username;

                return (
                  <tr key={link.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{link.name}</div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{link.channel?.name ?? "Canal"}</span>
                        {link.tag && (
                          <>
                            <span>•</span>
                            <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              Tag: {link.tag.name}
                            </span>
                          </>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      {missingUsername ? (
                        <div className="text-xs text-amber-600 dark:text-amber-400">
                          {INSTAGRAM_USERNAME_REQUIRED}{" "}
                          <Link href="/configuracoes/canais" className="underline font-medium">
                            Ir para Canais
                          </Link>
                        </div>
                      ) : link.url ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono font-medium">
                              {link.code}
                            </code>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-6 text-muted-foreground hover:text-foreground"
                              title="Copiar link"
                              onClick={() => handleCopy(link.url!)}
                            >
                              <CopyIcon className="size-3.5" />
                            </Button>
                          </div>
                          <p className="max-w-xs truncate text-[11px] text-muted-foreground font-mono">
                            {link.url}
                          </p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{link.code}</code>
                          <span>(Simulador interno)</span>
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 text-xs">
                      <span className="font-semibold text-foreground">{link.usesTotal}</span> total
                      <span className="text-muted-foreground"> · {link.uses7d} nos últimos 7d</span>
                    </td>

                    <td className="px-4 py-3">
                      {link.automations.length === 0 ? (
                        <span className="text-xs text-muted-foreground">Nenhuma vinculada</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {link.automations.map((a) => (
                            <Link
                              key={a.id}
                              href={`/automacoes/${a.id}`}
                              className="inline-flex items-center gap-1 rounded bg-secondary/80 px-1.5 py-0.5 text-xs font-medium text-secondary-foreground hover:bg-secondary"
                            >
                              <WorkflowIcon className="size-3" />
                              <span>{a.name}</span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                          link.status === "active"
                            ? "bg-secondary text-secondary-foreground"
                            : "text-muted-foreground"
                        }`}
                      >
                        {link.status === "active" ? "Ativo" : "Arquivado"}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {link.url && (
                          <QrDownloadDialog
                            url={link.url}
                            code={link.code}
                            name={link.name}
                          />
                        )}

                        {canWrite && link.status === "active" && (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              className="gap-1"
                              onClick={() => {
                                setEditingLink(link);
                                setDialogOpen(true);
                              }}
                            >
                              <PencilIcon className="size-3.5" />
                              <span>Editar</span>
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              className="gap-1 text-destructive hover:text-destructive"
                              onClick={() => setArchivingLink(link)}
                            >
                              <ArchiveIcon className="size-3.5" />
                              <span>Arquivar</span>
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de Criação / Edição */}
      <EntryLinkFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        link={editingLink}
        channels={channels}
        tags={tags}
        onSuccess={() => {
          setDialogOpen(false);
          refresh();
        }}
      />

      {/* Modal de Confirmação de Arquivamento */}
      <Dialog open={Boolean(archivingLink)} onOpenChange={(v) => !v && setArchivingLink(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Arquivar link de entrada?</DialogTitle>
            <DialogDescription>
              O link &quot;{archivingLink?.name}&quot; não iniciará mais automações nem registrará novos acessos. Os dados anteriores continuarão salvos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setArchivingLink(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => archivingLink && handleArchive(archivingLink)}
            >
              {pending && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Arquivar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EntryLinkFormDialog({
  open,
  onOpenChange,
  link,
  channels,
  tags,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  link: EntryLinkItem | null;
  channels: GrowthChannel[];
  tags: GrowthTag[];
  onSuccess: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(link?.name ?? "");
  const [channelId, setChannelId] = useState(link?.channel_id ?? channels[0]?.id ?? "");
  const [code, setCode] = useState(link?.code ?? "");
  const [tagId, setTagId] = useState(link?.tag_id ?? "");
  const [error, setError] = useState<string | null>(null);

  const isEditing = Boolean(link);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v && link) {
          setName(link.name);
          setChannelId(link.channel_id);
          setCode(link.code);
          setTagId(link.tag_id ?? "");
        } else if (v) {
          setName("");
          setChannelId(channels[0]?.id ?? "");
          setCode("");
          setTagId("");
        }
        setError(null);
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Editar link de entrada" : "Novo link de entrada"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Atualize o nome ou a tag associada ao link."
              : "Defina o canal, nome e código personalizado para o link."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const res = await saveEntryLink({
                id: link?.id ?? null,
                input: {
                  name: name.trim(),
                  channelId,
                  code: code.trim() || undefined,
                  tagId: tagId || null,
                },
              });
              if (!res.ok) {
                setError(res.error);
                return;
              }
              toast.success(isEditing ? "Link atualizado." : "Link criado com sucesso.");
              onSuccess();
            });
          }}
          className="space-y-4"
        >
          {error && (
            <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="link-name">Nome do link</Label>
            <Input
              id="link-name"
              placeholder="Ex: Bio do Instagram, Promoção de Verão"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={pending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="link-channel">Canal</Label>
            {isEditing ? (
              <Input
                id="link-channel"
                value={link?.channel?.name ?? ""}
                disabled
                className="bg-muted text-muted-foreground"
              />
            ) : (
              <select
                id="link-channel"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                disabled={pending}
                className={selectClass}
              >
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.name} ({ch.type === "instagram" ? "Instagram" : "Simulador"})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="link-code">Código do link</Label>
              {!isEditing && (
                <span className="text-[11px] text-muted-foreground">
                  Opcional (gerado automaticamente se em branco)
                </span>
              )}
            </div>
            <Input
              id="link-code"
              placeholder="Ex: promo10, blackfriday"
              value={code}
              onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
              disabled={pending || isEditing}
            />
            {!isEditing && (
              <p className="text-[11px] text-muted-foreground">
                3 a 40 caracteres com letras minúsculas, números, hífen ou sublinhado.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="link-tag">Etiqueta automática (opcional)</Label>
            <select
              id="link-tag"
              value={tagId}
              onChange={(e) => setTagId(e.target.value)}
              disabled={pending}
              className={selectClass}
            >
              <option value="">Nenhuma etiqueta</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Esta etiqueta será atribuída ao contato assim que ele abrir a conversa por este link.
            </p>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              {isEditing ? "Salvar alterações" : "Criar link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
