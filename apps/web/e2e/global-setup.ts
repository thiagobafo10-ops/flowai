import { clearRateLimits } from "./support/local-db";

export default function globalSetup() {
  clearRateLimits();
}
