import { clearRateLimits, ensureDefaultGrants } from "./support/local-db";

export default function globalSetup() {
  ensureDefaultGrants();
  clearRateLimits();
}
