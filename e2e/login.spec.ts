import { test, expect } from "@playwright/test";
import {
  assertAccessibility,
  assertNamedControls,
  assertUsableViewport,
} from "./helpers";

test.describe("login", () => {
  test("shows a labelled form and understandable configuration state", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Bienvenido de nuevo" }),
    ).toBeVisible();
    await expect(page.getByLabel("Correo electrónico")).toBeVisible();
    await expect(page.getByLabel("Contraseña")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Iniciar sesión" }),
    ).toBeVisible();
    await assertUsableViewport(page);
    await assertNamedControls(page);
    await assertAccessibility(page);
  });

  test("rejects browser-invalid email without sending credentials", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill("not-an-email");
    await page.getByLabel("Contraseña").fill("invalid-local-check");
    const submit = page.getByRole("button", { name: "Iniciar sesión" });
    if (await submit.isDisabled()) {
      await expect(page.getByRole("status")).toContainText(
        "no está disponible",
      );
    } else {
      await submit.click();
    }
    await expect(page.getByLabel("Correo electrónico")).toHaveValue(
      "not-an-email",
    );
    await expect(page).toHaveURL(/\/login$/);
  });

  test("captures the login baseline", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveScreenshot("login.png", {
      fullPage: true,
      animations: "disabled",
    });
  });
});
