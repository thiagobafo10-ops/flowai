"use client";

import { CHANNEL_TYPE_LABELS, contactDisplayName, formatRelativeTime, isUnread } from "@flowai/core";
import type { ConversationListItem } from "@/lib/inbox/queries";
import { cn } from "@/lib/utils";

export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function ConversationItem({ item, selected, now, timezone, onSelect }: {
  item: ConversationListItem; selected: boolean; now: string; timezone: string; onSelect: () => void;
}) {
  const name = contactDisplayName(item.contact);
  return (
    <button type="button" onClick={onSelect} aria-current={selected ? "true" : undefined}
      className={cn("flex w-full gap-3 border-b p-4 text-left transition-colors hover:bg-muted/70", selected && "bg-primary/8")}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium" aria-hidden="true">{initials(name)}</span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{name}</span>
          <time dateTime={item.lastMessageAt} className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(item.lastMessageAt, new Date(now), timezone)}</time>
        </span>
        <span className="block truncate text-sm text-muted-foreground">{item.preview ? `${item.preview.fromTeam ? "Você: " : ""}${item.preview.text}` : "Sem mensagens"}</span>
        <span className="flex items-center gap-2">
          <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">{CHANNEL_TYPE_LABELS[item.channel.type]}</span>
          {item.assignedTo && <span className="ml-auto text-xs text-muted-foreground" title={item.assignedTo.name}>{initials(item.assignedTo.name)}</span>}
          {isUnread(item) && <span aria-label="Conversa não lida" className="ml-auto size-2 rounded-full bg-primary" />}
        </span>
      </span>
    </button>
  );
}
