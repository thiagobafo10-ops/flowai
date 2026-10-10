export function isUnread(c: { lastInboundAt: string | null; lastReadAt: string | null }): boolean {
  if (c.lastInboundAt === null) return false;
  if (c.lastReadAt === null) return true;
  return new Date(c.lastInboundAt).getTime() > new Date(c.lastReadAt).getTime();
}
