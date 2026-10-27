import { protectedResourceMetadataResponse } from "@/lib/mcp/resource-metadata";

export function GET(request: Request): Response {
  return protectedResourceMetadataResponse(request);
}
