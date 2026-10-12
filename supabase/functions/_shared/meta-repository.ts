export type MetaSecrets = {
  connectionId: string; organizationId: string; appId: string; apiVersion: string;
  generation: number; disconnected: boolean; appSecret: string; verifyToken: string;
  channels: { channelId: string; accountId: string; accessToken: string; status: string }[];
};
export interface MetaConnectionRepository {
  saveConnection(actorId: string, organizationId: string, input: Record<string, unknown>): Promise<{ connectionId: string; channelId: string }>;
  readConnectionSecrets(connectionId: string): Promise<MetaSecrets | null>;
  verifyConnection(connectionId: string, kind: string, success: boolean, errorCode: string | null, generation: number): Promise<void>;
  disconnectConnection(actorId: string, organizationId: string, connectionId: string): Promise<void>;
  verifyMedia(connectionId: string, channelId: string, mediaId: string, generation: number): Promise<void>;
  removeConnection(actorId: string, organizationId: string, connectionId: string): Promise<{ removed: boolean; disconnected: boolean }>;
}
export class RepositoryError extends Error {
  /** `hint` carries only fixed, server-defined tokens (e.g. same_organization). */
  constructor(public code: string, public hint: string | null = null) { super("Database operation failed"); }
}
export function createMetaRepository(url: string, serviceKey: string, fetcher: typeof fetch): MetaConnectionRepository {
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const response = await fetcher(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" }, body: JSON.stringify(args), signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      let code = "database_error"; let hint: string | null = null;
      try { const data = await response.json(); if (typeof data.code === "string") code = data.code; if (data.hint === "same_organization") hint = data.hint; } catch { /* never propagate response body */ }
      throw new RepositoryError(code, hint);
    }
    const text = await response.text(); return (text ? JSON.parse(text) : undefined) as T;
  }
  return {
    saveConnection: (actorId, orgId, input) => rpc("save_instagram_connection", { p_actor_id: actorId, p_org_id: orgId, p_input: input }),
    readConnectionSecrets: (id) => rpc("read_meta_connection_secrets", { p_connection_id: id }),
    verifyConnection: (id, kind, success, errorCode, generation) => rpc("set_meta_connection_verification", { p_connection_id: id, p_kind: kind, p_success: success, p_error_code: errorCode, p_generation: generation }),
    disconnectConnection: (actorId, orgId, id) => rpc("disconnect_instagram_connection", { p_actor_id: actorId, p_org_id: orgId, p_connection_id: id }),
    verifyMedia: (connectionId, channelId, mediaId, generation) => rpc("verify_instagram_media", { p_connection_id: connectionId, p_channel_id: channelId, p_media_id: mediaId, p_generation: generation }),
    removeConnection: (actorId, orgId, id) => rpc("remove_instagram_connection", { p_actor_id: actorId, p_org_id: orgId, p_connection_id: id }),
  };
}
