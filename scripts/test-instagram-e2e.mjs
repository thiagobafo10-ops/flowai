// The migrated Instagram flows execute both local workers under the same safe harness.
process.env.FLOWAI_E2E_SUITE = "instagram";
await import("./test-automation-e2e.mjs");
