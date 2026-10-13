import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Test-only proxy supplies real Supabase Auth/REST/Realtime and injects a fake OpenAI.
export default defineConfig({
  ...base,
  testMatch: "ai.spec.ts",
  testIgnore: [],
  use: { ...base.use, baseURL: "http://localhost:3102" },
  webServer: {
    command: "npm run build && npx next start -p 3102",
    cwd: __dirname, url: "http://localhost:3102", reuseExistingServer: false, timeout: 240_000,
    env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54327" },
  },
});
