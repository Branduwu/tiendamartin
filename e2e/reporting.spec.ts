import { test, expect } from "@playwright/test";
import {
  login,
  hasCredentials,
  assertUsableViewport,
  assertAccessibility,
} from "./helpers";
test.describe("operational reporting read-only", () => {
  test.skip(!hasCredentials, "Email/password absent; no embedded credentials");
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
  });
  test("dashboard and period selection", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Dashboard", exact: true }),
    ).toBeVisible();
    await page.getByRole("combobox", { name: /^Periodo/ }).selectOption("7d");
    const response = page.waitForResponse(
      (r) =>
        r.url().includes("/api/v1/reports?") && r.request().method() === "GET",
    );
    await page
      .getByRole("button", { name: "Aplicar filtros", exact: true })
      .click();
    expect((await response).status()).toBe(200);
    await expect(page.getByRole("table").first()).toBeVisible();
    await assertUsableViewport(page);
    await assertAccessibility(page);
  });
  test("empty historical period", async ({ page }) => {
    await page
      .getByRole("combobox", { name: /^Periodo/ })
      .selectOption("custom");
    await page.getByLabel("Desde", { exact: true }).fill("2000-01-01");
    await page.getByLabel("Hasta", { exact: true }).fill("2000-01-01");
    await page
      .getByRole("button", { name: "Aplicar filtros", exact: true })
      .click();
    await expect(
      page.getByText("Sin ventas ni devoluciones en este periodo.", {
        exact: true,
      }),
    ).toBeVisible();
    await assertUsableViewport(page);
    await assertAccessibility(page);
  });
});
