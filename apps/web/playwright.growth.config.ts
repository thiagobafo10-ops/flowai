import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: "growth.spec.ts",
  testIgnore: [],
  use: { ...base.use, baseURL: "http://localhost:3103" },
  webServer: {
    command: "npm run build && npx next start -p 3103",
    cwd: __dirname,
    url: "http://localhost:3103",
    reuseExistingServer: false,
    timeout: 240_000,
    env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54328" },
  },
});
