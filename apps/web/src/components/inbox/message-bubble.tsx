"use client";

import type { MessageItem } from "@/lib/inbox/queries";
import { automationOptions } from "@/lib/inbox/automation-display";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const STATUS = { pending: "Enviando…", sent: "Enviada", delivered: "Entregue", read: "Lida", failed: "Falhou" };

export function MessageBubble({ message, userId, timezone, canWrite, channelType, busy, onRetry, onOptionClick }: {
  message: MessageItem; userId: string; timezone: string; canWrite: boolean; channelType: string; busy: boolean;
  onRetry: (id: string) => void; onOptionClick: (messageId: string, optionId: string) => void;
}) {
  if (message.senderType === "system") return <p data-testid="system-message" className="my-4 text-center text-xs text-muted-foreground">{message.text}</p>;
  const own = message.senderUserId === userId;
  const author = message.senderType === "ai" || message.senderType === "automation" ? null : own ? "Você" : message.senderName;
  const options = automationOptions(message, { canWrite, channelType });
  return (
    <article data-testid="message-bubble" className={cn("max-w-[85%] space-y-1 rounded-xl border px-3 py-2 text-sm", message.direction === "inbound" ? "mr-auto bg-background" : "ml-auto bg-primary/8", message.isInternalNote && "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950")}>
      {message.isInternalNote && <span className="block text-xs font-medium text-amber-800 dark:text-amber-200">Nota interna</span>}
      {author && <p className="text-xs font-medium">{author}</p>}
      {message.context?.origin === "story_reply" && <p className="text-xs text-muted-foreground">Resposta a story</p>}
      {message.context?.origin === "story_mention" && <p className="text-xs text-muted-foreground">Menção em story</p>}
      {message.context?.origin === "comment" && <p className="text-xs text-muted-foreground">Resposta privada a comentário</p>}
      <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.text}</p>
      {options.length > 0 && (
        <div data-testid="automation-options" className="flex flex-wrap gap-1 pt-1">
          {options.map((o) =>
            o.mode === "link" ? (
              <a key={o.id} href={o.url} target="_blank" rel="noopener noreferrer" className="rounded-md border bg-background px-2 py-1 text-xs font-medium underline-offset-2 hover:underline">{o.title}</a>
            ) : o.mode === "click" ? (
              <Button key={o.id} type="button" size="xs" variant="outline" disabled={busy} onClick={() => onOptionClick(message.id, o.id)}>{o.title}</Button>
            ) : (
              <span key={o.id} className="rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground">{o.title}</span>
            ),
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">{message.senderType === "ai" && <span data-testid="ai-badge" className="rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase">IA</span>}{message.senderType === "automation" && <span data-testid="automation-badge" className="rounded border px-1.5 py-0.5 text-[10px] font-medium">Automação</span>}<time dateTime={message.createdAt}>{new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</time>
        {message.direction === "outbound" && !message.isInternalNote && <span>{message.status === "pending" && message.error ? "Sem confirmação" : STATUS[message.status]}</span>}
      </div>
      {message.status === "failed" && <div className="text-xs text-destructive">{message.error && <p>{message.error}</p>}{canWrite && own && <Button variant="link" size="xs" disabled={busy} onClick={() => onRetry(message.id)}>Tentar novamente</Button>}</div>}
      {message.status === "pending" && message.error && <p className="text-xs text-amber-700 dark:text-amber-300">{message.error}</p>}
    </article>
  );
}
