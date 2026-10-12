import type { ChannelContactProfile, ChannelProvider, ChannelRecipient, InboundMessage, OutboundContent } from "../types.ts";
import { InstagramError } from "./errors.ts";
import { parseInstagramEvents } from "./parse.ts";
import { instagramIdSchema, instagramTextSchema, instagramVersionSchema } from "./schemas.ts";
import type { InstagramProviderOptions } from "./types.ts";

export class InstagramProvider implements ChannelProvider {
  private readonly options: InstagramProviderOptions;
  constructor(options: InstagramProviderOptions) {
    if (!instagramIdSchema.safeParse(options.accountId).success || !instagramVersionSchema.safeParse(options.apiVersion).success || !options.accessToken.trim()) throw new InstagramError("invalid_config", "rejected");
    this.options = options;
  }

  receiveMessage(raw: unknown): InboundMessage[] {
    return parseInstagramEvents(raw).filter((event) => event.kind === "message").map((event) => ({ externalId: event.externalId, senderExternalId: event.senderExternalId, senderName: event.senderName, text: event.text, sentAt: event.occurredAt }));
  }

  private async request(path: string, body?: unknown): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.options.fetch(`https://graph.instagram.com/${this.options.apiVersion}/${path}`, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${this.options.accessToken}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
    } catch { throw new InstagramError("network_error", "uncertain"); }
    let result: Record<string, unknown>;
    try { result = await response.json() as Record<string, unknown>; } catch { throw new InstagramError("invalid_response", response.ok || response.status >= 500 ? "uncertain" : "rejected"); }
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new InstagramError("invalid_response", "uncertain");
    if (!response.ok || result.error) {
      const error = result.error as { code?: number } | undefined;
      const code = error?.code === 190 ? "invalid_token" : error?.code === 10 || error?.code === 200 ? "permission_denied" : response.status === 429 || error?.code === 4 || error?.code === 613 ? "rate_limited" : "provider_rejected";
      throw new InstagramError(code, response.status >= 500 ? "uncertain" : "rejected");
    }
    return result;
  }

  private async send(recipient: { id: string } | { comment_id: string }, text: string) {
    if (!instagramTextSchema.safeParse(text).success) throw new InstagramError("invalid_content", "rejected");
    const id = "id" in recipient ? recipient.id : recipient.comment_id;
    if (!id || id.length > 1024) throw new InstagramError("invalid_content", "rejected");
    const result = await this.request(`${this.options.accountId}/messages`, { recipient, message: { text } });
    if (typeof result.message_id !== "string" || !result.message_id) throw new InstagramError("invalid_response", "uncertain");
    return result;
  }

  async sendMessage(to: ChannelRecipient, content: OutboundContent): Promise<{ externalId: string }> {
    const result = await this.send({ id: to.externalId }, content.text);
    return { externalId: result.message_id as string };
  }

  async sendPrivateReply(commentId: string, text: string): Promise<{ externalId: string; recipientId: string }> {
    const result = await this.send({ comment_id: commentId }, text);
    if (typeof result.recipient_id !== "string" || !result.recipient_id) throw new InstagramError("invalid_response", "uncertain");
    return { externalId: result.message_id as string, recipientId: result.recipient_id };
  }

  async markAsRead(_externalMessageId: string): Promise<void> {
    // Official Instagram Login sender-actions examples currently use the Facebook
    // host and even show typing_on for mark_seen. Do not guess a cross-API call.
    throw new InstagramError("unsupported_capability", "rejected");
  }

  async getContact(externalUserId: string): Promise<ChannelContactProfile> {
    if (!instagramIdSchema.safeParse(externalUserId).success) throw new InstagramError("invalid_content", "rejected");
    const result = await this.request(`${externalUserId}?fields=name%2Cusername`);
    return { name: typeof result.name === "string" ? result.name : typeof result.username === "string" ? result.username : null };
  }
}
