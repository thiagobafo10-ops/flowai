import { z } from "zod";
import { instagramEnvelopeSchema } from "./schemas.ts";
import type { InstagramEvent, InstagramMessageContext } from "./types.ts";

const identity = z.object({ id: z.string().min(1).max(100) });
const messagingSchema = z.object({ sender: identity, recipient: identity, timestamp: z.number(), message: z.record(z.string(), z.unknown()).optional(), read: z.object({ mid: z.string().min(1) }).optional(), postback: z.record(z.string(), z.unknown()).optional() }).passthrough();
const postbackSchema = z.object({ mid: z.string().min(1).max(1024).optional(), title: z.string().max(1000), payload: z.string().min(1).max(2000), is_echo: z.boolean().optional(), is_self: z.boolean().optional() }).passthrough();
const quickReplySchema = z.object({ payload: z.string().min(1).max(2000) }).passthrough();
const messageSchema = z.object({ mid: z.string().min(1).max(1024), text: z.string().max(4096).optional(), is_echo: z.boolean().optional(), is_self: z.boolean().optional(), is_deleted: z.boolean().optional(), is_unsupported: z.boolean().optional(), quick_reply: quickReplySchema.optional(), attachments: z.array(z.object({ type: z.string().max(100) }).passthrough()).optional(), reply_to: z.object({ story: z.object({ id: z.string().optional() }).passthrough().optional() }).passthrough().optional() }).passthrough();
const changeSchema = z.object({ field: z.string(), value: z.unknown() });
const commentSchema = z.object({ id: z.string().min(1).max(1024), from: z.object({ id: z.string().min(1).max(100), username: z.string().max(255).optional() }), text: z.string().max(4096).optional(), media: z.object({ id: z.string().min(1).max(100), media_product_type: z.string().optional() }) });

function timestamp(value: number, milliseconds: boolean): string {
  const date = new Date(milliseconds ? value : value * 1000);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid Instagram event timestamp");
  return date.toISOString();
}

export function parseInstagramEvents(raw: unknown): InstagramEvent[] {
  const envelope = instagramEnvelopeSchema.parse(raw);
  const events: InstagramEvent[] = [];
  for (const entry of envelope.entry) {
    for (const rawMessage of entry.messaging ?? []) {
      const event = messagingSchema.parse(rawMessage);
      const occurredAt = timestamp(event.timestamp, true);
      const base = { accountId: entry.id, occurredAt };
      if (event.message) {
        const message = messageSchema.parse(event.message);
        if (message.is_echo || message.is_self || message.is_deleted) {
          events.push({ ...base, kind: "ignored", externalId: message.mid, reason: message.is_deleted ? "deleted_message" : "echo" });
          continue;
        }
        if (event.recipient.id !== entry.id || event.sender.id === entry.id) throw new Error("Invalid Instagram message recipient");
        const attachment = message.attachments?.[0];
        let context: InstagramMessageContext = { origin: "direct" };
        if (message.quick_reply) context = { origin: "quick_reply", payload: message.quick_reply.payload };
        else if (message.reply_to?.story) context = { origin: "story_reply", ...(message.reply_to.story.id ? { storyId: message.reply_to.story.id } : {}) };
        else if (attachment?.type === "story_mention") context = { origin: "story_mention", attachmentType: attachment.type };
        else if (attachment) context = { origin: "attachment", attachmentType: attachment.type };
        const text = message.text?.trim() ? message.text : context.origin === "story_mention" ? "[Menção em story]" : message.is_unsupported ? "[Conteúdo não suportado]" : "[Mídia recebida]";
        events.push({ ...base, kind: "message", externalId: message.mid, senderExternalId: event.sender.id, senderName: null, text, context });
      } else if (event.postback) {
        const postback = postbackSchema.parse(event.postback);
        const externalId = postback.mid ?? `postback:${event.timestamp}:${event.sender.id}`;
        if (postback.is_echo || postback.is_self || event.sender.id === entry.id) {
          events.push({ ...base, kind: "ignored", externalId, reason: "echo" });
          continue;
        }
        if (event.recipient.id !== entry.id) throw new Error("Invalid Instagram postback recipient");
        events.push({ ...base, kind: "button", externalId, senderExternalId: event.sender.id, title: postback.title, payload: postback.payload });
      } else if (event.read) {
        if (event.recipient.id !== entry.id) throw new Error("Invalid Instagram receipt recipient");
        events.push({ ...base, kind: "status", externalId: `${event.read.mid}:read:${event.timestamp}`, messageExternalId: event.read.mid, state: "read" });
      } else events.push({ ...base, kind: "ignored", externalId: `unsupported:${event.timestamp}:${event.sender.id}`, reason: "unsupported_messaging_event" });
    }
    const changes = entry.changes ?? (entry.field ? [{ field: entry.field, value: entry.value }] : []);
    for (const rawChange of changes) {
      const change = changeSchema.parse(rawChange);
      if (entry.time === undefined) throw new Error("Missing Instagram event timestamp");
      const base = { accountId: entry.id, occurredAt: timestamp(entry.time, entry.time > 1e12) };
      if (change.field === "comments") {
        const comment = commentSchema.parse(change.value);
        events.push({ ...base, kind: "comment", externalId: comment.id, commentId: comment.id, mediaId: comment.media.id, mediaProductType: comment.media.media_product_type ?? null, senderExternalId: comment.from.id, senderName: comment.from.username ?? null, text: comment.text ?? "" });
      } else events.push({ ...base, kind: "ignored", externalId: `${change.field}:${entry.time}`, reason: "unsupported_change" });
    }
  }
  return events;
}
