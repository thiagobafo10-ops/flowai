// AI uses the same bounded cancellation and Vault/cron recovery as automation.
process.env.FLOWAI_E2E_SUITE = "ai";
await import("./test-automation-e2e.mjs");
