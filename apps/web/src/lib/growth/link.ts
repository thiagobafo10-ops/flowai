import { instagramEntryLink } from "@flowai/core";

export function readyEntryLink(channel: { type: string; username: string | null }, code: string): string | null {
  return channel.type === "instagram" && channel.username ? instagramEntryLink(channel.username, code) : null;
}
