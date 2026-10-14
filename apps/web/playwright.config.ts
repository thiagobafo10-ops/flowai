import { defineConfig, devices } from "@playwright/test";

// Opt-in local mode for the 8 GB host. CI and normal defaults keep their original deadlines.
const slowHost = !process.env.CI && process.env.FLOWAI_E2E_SLOW_HOST === "1";

// O e2e roda contra o build de produção (next build + next start na porta 3100):
// sem compilação sob demanda nem recarga do dev server no meio dos testes.
export default defineConfig({
  testDir: "e2e",
  testIgnore: ["instagram.spec.ts", "ai.spec.ts", "automation.spec.ts", "growth.spec.ts"],
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: slowHost ? 60_000 : 30_000,
  expect: { timeout: slowHost ? 15_000 : 5_000 },
  reporter: "list",
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  webServer: {
    command: "npm run build && npx next start -p 3100",
    cwd: __dirname,
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
