import { expect, type Locator, type Page } from "@playwright/test";

/** Espera o React hidratar (marcador posto por HydrationMarker no layout raiz). */
export async function waitForHydration(page: Page): Promise<void> {
  await page.locator('html[data-hydrated="1"]').waitFor({ state: "attached" });
}

/** page.goto + espera a hidratação: formulários e cliques só depois do React assumir. */
export async function gotoReady(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await waitForHydration(page);
}

/** page.reload + espera a hidratação. */
export async function reloadReady(page: Page): Promise<void> {
  await page.reload();
  await waitForHydration(page);
}

/** Espera uma ação otimista terminar (o contêiner expõe aria-busy). */
export async function settled(container: Locator): Promise<void> {
  await expect(container).toHaveAttribute("aria-busy", "false");
}
