export type InstagramErrorCode = "invalid_config" | "invalid_content" | "invalid_token" | "permission_denied" | "rate_limited" | "provider_rejected" | "network_error" | "invalid_response" | "unsupported_capability";
export class InstagramError extends Error {
  constructor(public readonly code: InstagramErrorCode, public readonly certainty: "rejected" | "uncertain") {
    super(`Instagram: ${code}`);
    this.name = "InstagramError";
  }
}
