import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export const hasCredentials = Boolean(
  process.env.E2E_EMAIL && process.env.E2E_PASSWORD,
);

export async function login(page: Page): Promise<void> {
  if (!hasCredentials)
    throw new Error("E2E_EMAIL and E2E_PASSWORD are required");
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Contraseña").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/products$/);
}

export async function assertUsableViewport(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.scrollWidth, "horizontal overflow").toBeLessThanOrEqual(
    dimensions.clientWidth,
  );
  expect(dimensions.viewportWidth).toBeGreaterThan(0);
  const offscreen = await page.locator("button, a, input, select").evaluateAll(
    (elements) =>
      elements.filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 && (rect.right < 0 || rect.left > window.innerWidth)
        );
      }).length,
  );
  expect(offscreen, "interactive controls outside viewport").toBe(0);
}

export async function assertAccessibility(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

export async function assertNamedControls(page: Page): Promise<void> {
  const unnamed = await page
    .locator("button, input, select, textarea")
    .evaluateAll(
      (elements) =>
        elements.filter((element) => {
          const label = element.getAttribute("aria-label");
          const labelledBy = element.getAttribute("aria-labelledby");
          const text = element.textContent?.trim();
          const id = element.getAttribute("id");
          const associated = id
            ? document.querySelector(`label[for="${CSS.escape(id)}"]`)
            : element.closest("label");
          return !label && !labelledBy && !text && !associated;
        }).length,
    );
  expect(unnamed, "interactive controls without an accessible name").toBe(0);
}
