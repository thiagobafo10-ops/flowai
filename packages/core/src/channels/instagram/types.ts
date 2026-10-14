type EventBase = { accountId: string; externalId: string; occurredAt: string };
export type InstagramMessageContext = {
  origin: "direct" | "story_reply" | "story_mention" | "attachment" | "quick_reply";
  storyId?: string;
  attachmentType?: string;
  payload?: string;
  referral?: { ref: string };
};
export type InstagramEvent =
  | (EventBase & { kind: "message"; senderExternalId: string; senderName: string | null; text: string; context: InstagramMessageContext })
  | (EventBase & { kind: "button"; senderExternalId: string; title: string; payload: string })
  | (EventBase & { kind: "referral"; senderExternalId: string; ref: string; source: string | null })
  | (EventBase & { kind: "comment"; commentId: string; mediaId: string; mediaProductType: string | null; senderExternalId: string; senderName: string | null; text: string })
  | (EventBase & { kind: "status"; messageExternalId: string; state: "read" })
  | (EventBase & { kind: "ignored"; reason: string });

export type InstagramProviderOptions = {
  accountId: string;
  accessToken: string;
  apiVersion: string;
  fetch: typeof fetch;
  now: () => Date;
};
