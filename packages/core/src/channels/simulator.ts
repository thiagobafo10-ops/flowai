import { simulatorInboundSchema } from "./schemas.ts";
import type {
  ChannelContactProfile,
  ChannelProvider,
  ChannelRecipient,
  InboundMessage,
  OutboundContent,
} from "./types.ts";

export class SimulatorProvider implements ChannelProvider {
  receiveMessage(raw: unknown): InboundMessage[] {
    const { name, phone, text } = simulatorInboundSchema.parse(raw);
    return [
      {
        externalId: "sim_" + crypto.randomUUID(),
        senderExternalId: phone,
        senderName: name,
        text,
        sentAt: new Date().toISOString(),
      },
    ];
  }

  async sendMessage(_to: ChannelRecipient, _content: OutboundContent): Promise<{ externalId: string }> {
    return { externalId: "sim_" + crypto.randomUUID() };
  }

  async markAsRead(_externalMessageId: string): Promise<void> {}

  async getContact(_externalUserId: string): Promise<ChannelContactProfile> {
    return { name: null };
  }
}
