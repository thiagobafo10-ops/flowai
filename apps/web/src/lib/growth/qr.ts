import QRCode from "qrcode";

export function entryLinkQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", margin: 4, errorCorrectionLevel: "M" });
}
export function entryLinkQrPng(url: string): Promise<string> {
  return QRCode.toDataURL(url, { type: "image/png", width: 1024, margin: 4, errorCorrectionLevel: "M" });
}
