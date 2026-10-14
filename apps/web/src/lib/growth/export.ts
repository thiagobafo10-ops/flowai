import { entryLinkQrPng, entryLinkQrSvg } from "./qr";

export async function copyEntryLink(url: string): Promise<void> {
  await navigator.clipboard.writeText(url);
}

export async function downloadEntryLinkQr(
  url: string,
  filenameBase: string,
  format: "png" | "svg",
): Promise<void> {
  let blob: Blob;
  if (format === "svg") {
    const svg = await entryLinkQrSvg(url);
    blob = new Blob([svg], { type: "image/svg+xml" });
  } else {
    const dataUrl = await entryLinkQrPng(url);
    const base64 = dataUrl.split(",")[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    blob = new Blob([bytes], { type: "image/png" });
  }

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = `${filenameBase}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
