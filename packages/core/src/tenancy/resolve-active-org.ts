export type MembershipRef = { organizationId: string; createdAt: string };

/**
 * Resolve a organização ativa. O cookie só é respeitado se o usuário for
 * membro; caso contrário usa a membership mais antiga. Sem memberships: null.
 */
export function resolveActiveOrg(
  cookieOrgId: string | null,
  memberships: MembershipRef[],
): string | null {
  if (memberships.length === 0) return null;
  if (cookieOrgId && memberships.some((x) => x.organizationId === cookieOrgId)) {
    return cookieOrgId;
  }
  const oldest = [...memberships].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  )[0];
  return oldest ? oldest.organizationId : null;
}
