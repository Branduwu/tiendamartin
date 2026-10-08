import { test, expect } from "@playwright/test";
import { assertUsableViewport, assertAccessibility } from "./helpers";
const state = process.env.E2E_STORAGE_STATE_PATH;
test.use({ ...(state ? { storageState: state } : {}) });
test.describe("TASK031 platform read-only smoke", () => {
  test.skip(!state, "Authorized ephemeral platform session not supplied");
  test("platform dashboard", async ({ page }) => {
    await page.goto("/platform");
    await expect(
      page.getByText("Administración de SmartRetail", { exact: true }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await assertUsableViewport(page);
    await assertAccessibility(page);
  });
  test("companies directory and owner selection", async ({ page }) => {
    await page.goto("/platform/companies");
    await expect(
      page.getByRole("button", { name: "Crear empresa", exact: true }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await assertUsableViewport(page);
    await assertAccessibility(page);
  });
  test("company metadata detail", async ({ page }) => {
    test.skip(!process.env.E2E_COMPANY_ID, "Controlled company not supplied");
    await page.goto("/platform/companies/" + process.env.E2E_COMPANY_ID);
    await expect(
      page.getByRole("heading", { name: "Estado de la empresa", exact: true }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await assertUsableViewport(page);
    await assertAccessibility(page);
  });
});
test.describe("TASK031 ordinary owner denied", () => {
  const owner = process.env.E2E_OWNER_STATE_PATH;
  test.use({ ...(owner ? { storageState: owner } : {}) });
  test.skip(!owner, "Authorized ephemeral ordinary owner not supplied");
  test("no platform access even with forged identity headers", async ({
    page,
    request,
  }) => {
    await page.goto("/platform/companies");
    await expect(
      page.getByRole("heading", { name: "Acceso restringido" }),
    ).toBeVisible();
    const r = await request.get("/api/v1/platform/companies", {
      headers: { "x-role": "platform_admin" },
    });
    expect(r.status()).toBe(403);
    await assertUsableViewport(page);
    await assertAccessibility(page);
  });
});
