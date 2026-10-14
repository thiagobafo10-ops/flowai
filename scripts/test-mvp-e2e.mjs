// Acceptance reuses the local AI proxy and coordinated worker state restoration.
process.env.FLOWAI_E2E_SUITE = "mvp";
await import("./test-automation-e2e.mjs");
