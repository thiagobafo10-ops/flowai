"use client";

import type { MessageItem } from "@/lib/inbox/queries";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const STATUS = { pending: "Enviando…", sent: "Enviada", delivered: "Entregue", read: "Lida", failed: "Falhou" };

export function MessageBubble({ message, userId, timezone, canWrite, busy, onRetry }: {
  message: MessageItem; userId: string; timezone: string; canWrite: boolean; busy: boolean; onRetry: (id: string) => void;
}) {
  if (message.senderType === "system") return <p data-testid="system-message" className="my-4 text-center text-xs text-muted-foreground">{message.text}</p>;
  const own = message.senderUserId === userId;
  const author = message.senderType === "ai" ? null : message.senderType === "automation" ? "Automação" : own ? "Você" : message.senderName;
  return (
    <article data-testid="message-bubble" className={cn("max-w-[85%] space-y-1 rounded-xl border px-3 py-2 text-sm", message.direction === "inbound" ? "mr-auto bg-background" : "ml-auto bg-primary/8", message.isInternalNote && "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950")}>
      {message.isInternalNote && <span className="block text-xs font-medium text-amber-800 dark:text-amber-200">Nota interna</span>}
      {author && <p className="text-xs font-medium">{author}</p>}
      {message.context?.origin === "story_reply" && <p className="text-xs text-muted-foreground">Resposta a story</p>}
      {message.context?.origin === "story_mention" && <p className="text-xs text-muted-foreground">Menção em story</p>}
      {message.context?.origin === "comment" && <p className="text-xs text-muted-foreground">Resposta privada a comentário</p>}
      <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.text}</p>
      <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">{message.senderType === "ai" && <span data-testid="ai-badge" className="rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase">IA</span>}<time dateTime={message.createdAt}>{new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</time>
        {message.direction === "outbound" && !message.isInternalNote && <span>{message.status === "pending" && message.error ? "Sem confirmação" : STATUS[message.status]}</span>}
      </div>
      {message.status === "failed" && <div className="text-xs text-destructive">{message.error && <p>{message.error}</p>}{canWrite && own && <Button variant="link" size="xs" disabled={busy} onClick={() => onRetry(message.id)}>Tentar novamente</Button>}</div>}
      {message.status === "pending" && message.error && <p className="text-xs text-amber-700 dark:text-amber-300">{message.error}</p>}
    </article>
  );
}
