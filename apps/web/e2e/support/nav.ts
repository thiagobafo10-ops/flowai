import { expect, type Locator, type Page } from "@playwright/test";

/** Espera o React hidratar (marcador posto por HydrationMarker no layout raiz). */
export async function waitForHydration(page: Page): Promise<void> {
  await page.locator('html[data-hydrated="1"]').waitFor({ state: "attached" });
  // React streaming entrega cada Suspense resolvido num <div hidden id="S:n"> e só
  // o move para o lugar (e remove) num reveal posterior, que o React 19 agrupa/adia.
  // Até lá o mesmo texto existe duas vezes no DOM (uma oculta) e getByText vira
  // violação de strict mode. A página só está pronta quando não há segmento pendente.
  await page.waitForFunction(() => document.querySelector('div[hidden][id^="S:"]') === null);
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
