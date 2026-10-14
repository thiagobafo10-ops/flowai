// Canonical grants that e2e fixtures (breakMembershipsRead/breakDashboardRpc) revoke temporarily.
// Shared by the Playwright globalSetup and the E2E runners so interrupted runs are healed.
export const DEFAULT_GRANTS = "grant select on public.memberships to authenticated; grant execute on function public.dashboard_metrics(uuid, int) to authenticated;";
