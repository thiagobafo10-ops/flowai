import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Test-only proxy supplies real Supabase Auth/REST/Realtime and injects Graph.
export default defineConfig({
  ...base,
  testMatch: "instagram.spec.ts",
  testIgnore: [],
  use: { ...base.use, baseURL: "http://localhost:3101" },
  webServer: {
    command: "npm run build && npx next start -p 3101",
    cwd: __dirname, url: "http://localhost:3101", reuseExistingServer: false, timeout: 240_000,
    env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54326" },
  },
});
