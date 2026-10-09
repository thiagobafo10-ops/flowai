import { headers } from "next/headers";

export async function getRequestIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}
