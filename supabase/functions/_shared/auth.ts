export type Authorize = (request: Request, organizationId: string, minimumRole: "admin" | "agent") => Promise<{ userId: string } | null>;
export function createAuthorize(url: string, anonKey: string, fetcher: typeof fetch): Authorize {
  return async (request, organizationId, minimumRole) => {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return null;
    const headers = { apikey: anonKey, Authorization: authorization };
    // Auth's server validates the signature, revocation and actual user. Never
    // trust a merely decoded token or a user ID in the request body.
    const userResponse = await fetcher(`${url}/auth/v1/user`, { headers, signal: AbortSignal.timeout(10000) });
    if (!userResponse.ok) return null;
    const user = await userResponse.json();
    if (typeof user.id !== "string") return null;
    const params = new URLSearchParams({ select: "role", organization_id: `eq.${organizationId}`, user_id: `eq.${user.id}` });
    const membershipResponse = await fetcher(`${url}/rest/v1/memberships?${params}`, { headers, signal: AbortSignal.timeout(10000) });
    if (!membershipResponse.ok) return null;
    const memberships = await membershipResponse.json();
    const allowed = minimumRole === "admin" ? ["owner", "admin"] : ["owner", "admin", "agent"];
    return Array.isArray(memberships) && memberships.some((item) => allowed.includes(item.role)) ? { userId: user.id } : null;
  };
}
