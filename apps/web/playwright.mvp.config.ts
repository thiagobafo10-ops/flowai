import { defineConfig } from "@playwright/test";
import ai from "./playwright.ai.config";
import { mvpWebServerCommand } from "../../scripts/lib/e2e-suite.mjs";

const server = ai.webServer;
if (!server || Array.isArray(server)) throw new Error("MVP requires the single local AI web server.");

// One production build with real local Auth/REST/RLS and the existing fake OpenAI.
// Automation execution is covered separately by playwright.automation.config.ts.
export default defineConfig({
  ...ai,
  testMatch: ["mvp-journey.spec.ts", "ai.spec.ts", "analytics.spec.ts"],
  webServer: {
    ...server,
    // Only after a fresh MVP build with unchanged production sources/public URL 54327.
    command: mvpWebServerCommand(process.env.FLOWAI_E2E_REUSE_BUILD === "1", Number(process.env.FLOWAI_E2E_PROXY_PORT ?? 54327)),
  },
});
