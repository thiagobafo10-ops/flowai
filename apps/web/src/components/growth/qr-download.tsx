"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DownloadIcon, Loader2Icon, QrCodeIcon } from "lucide-react";
import { toast } from "sonner";
import { entryLinkQrSvg } from "@/lib/growth/qr";
import { downloadEntryLinkQr } from "@/lib/growth/export";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function QrDownloadDialog({
  url,
  code,
  name,
}: {
  url: string;
  code: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);

  const qrQuery = useQuery({
    queryKey: ["entry-link-qr", url],
    queryFn: () => entryLinkQrSvg(url),
    enabled: open && Boolean(url),
  });

  async function handleDownload(format: "png" | "svg") {
    try {
      await downloadEntryLinkQr(url, code, format);
      toast.success(`QR code (${format.toUpperCase()}) baixado com sucesso.`);
    } catch {
      toast.error(`Falha ao baixar QR code em ${format.toUpperCase()}.`);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <QrCodeIcon className="size-3.5" />
        <span>QR Code</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>QR Code — {name}</DialogTitle>
            <DialogDescription>
              Aponte a câmera do celular para abrir o link de entrada.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center p-4">
            {qrQuery.isPending ? (
              <div className="flex size-48 items-center justify-center">
                <Loader2Icon className="size-8 animate-spin text-muted-foreground" />
              </div>
            ) : qrQuery.data ? (
              <div
                className="size-56 rounded-xl border bg-white p-3 shadow-xs dark:bg-white [&>svg]:size-full"
                dangerouslySetInnerHTML={{ __html: qrQuery.data }}
              />
            ) : (
              <div className="flex size-48 items-center justify-center text-muted-foreground">
                Não foi possível gerar
              </div>
            )}
            <p className="mt-3 max-w-full truncate text-xs text-muted-foreground">
              {url}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleDownload("svg")}
              className="gap-1.5"
            >
              <DownloadIcon className="size-3.5" />
              Baixar SVG
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => handleDownload("png")}
              className="gap-1.5"
            >
              <DownloadIcon className="size-3.5" />
              Baixar PNG
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
