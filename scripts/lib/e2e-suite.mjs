// Ports and test proxies are local-only; every suite restores all shared workers.
export function selectE2eSuite(name = "automation") {
  const suites = {
    automation: { port: 54328, webPort: 3103, config: "playwright.automation.config.ts", proxy: "serve-automation-e2e.ts", ready: "graph-calls" },
    instagram: { port: 54326, webPort: 3101, config: "playwright.integration.config.ts", proxy: "serve-automation-e2e.ts", ready: "graph-calls" },
    ai: { port: 54327, webPort: 3102, config: "playwright.ai.config.ts", proxy: "serve-ai-e2e.ts", ready: "openai-calls" },
    mvp: { port: 54327, webPort: 3102, config: "playwright.mvp.config.ts", proxy: "serve-ai-e2e.ts", ready: "openai-calls" },
  };
  if (!Object.hasOwn(suites, name)) throw new Error("Suíte E2E local desconhecida.");
  return { name, ...suites[name], workerKinds: ["automation", "ai", "instagram"] };
}

export function mvpWebServerCommand(reuseBuild, proxyPort) {
  if (reuseBuild && proxyPort !== 54327) throw new Error("Reutilização MVP exige o build do proxy público 54327.");
  return reuseBuild ? "npx next start -p 3102" : "npm run build && npx next start -p 3102";
}
