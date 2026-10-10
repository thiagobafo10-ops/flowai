export type ChannelType = "whatsapp" | "instagram" | "simulator";

export const CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  simulator: "Simulador",
};

export type InboundMessage = {
  externalId: string;
  senderExternalId: string;
  senderName: string | null;
  text: string;
  sentAt: string;
};

export type ChannelRecipient = { externalId: string };
export type OutboundContent = { text: string };
export type ChannelContactProfile = { name: string | null };

export interface ChannelProvider {
  receiveMessage(raw: unknown): InboundMessage[];
  sendMessage(to: ChannelRecipient, content: OutboundContent): Promise<{ externalId: string }>;
  markAsRead(externalMessageId: string): Promise<void>;
  getContact(externalUserId: string): Promise<ChannelContactProfile>;
}
