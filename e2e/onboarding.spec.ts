import { test, expect } from "@playwright/test";
import { assertUsableViewport, assertAccessibility } from "./helpers";
test("TASK032 public registration is simple and accessible", async ({
  page,
}) => {
  await page.goto("/register");
  await expect(
    page.getByRole("heading", { name: "Crea tu cuenta" }),
  ).toBeVisible();
  await expect(page.getByLabel("Correo electrónico")).toHaveAttribute(
    "type",
    "email",
  );
  await expect(page.getByLabel("Contraseña", { exact: true })).toHaveAttribute(
    "minlength",
    "8",
  );
  await assertUsableViewport(page);
  await assertAccessibility(page);
});
test("TASK032 invitation handoff can be discarded without exposing its token", async ({
  page,
}) => {
  await page.goto("/invite#token=" + "a".repeat(64));
  await expect(
    page.getByRole("link", { name: "Iniciar sesión", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/invite$/);
  await assertUsableViewport(page);
  await assertAccessibility(page);
  await page
    .getByRole("button", { name: "Descartar invitación y volver a mi cuenta" })
    .click();
  await expect(page).toHaveURL(/\/login$/);
});
test.describe("TASK032 owner invitations", () => {
  const state = process.env.E2E_STORAGE_STATE_PATH;
  test.use({ ...(state ? { storageState: state } : {}) });
  test.skip(!state, "Controlled owner session required");
  test("users and invitation management remain accessible", async ({
    page,
  }) => {
    await page.goto("/settings/users");
    await expect(
      page.getByRole("heading", { name: "Invitar a tu equipo" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Crear invitación", exact: true }),
    ).toBeEnabled();
    await assertUsableViewport(page);
    await assertAccessibility(page);
  });
});
