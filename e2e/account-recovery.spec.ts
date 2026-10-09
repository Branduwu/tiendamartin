import { test, expect } from "@playwright/test";
import { assertAccessibility, assertUsableViewport } from "./helpers";

test("forgot password stays generic for provider success and throttling", async ({
  page,
}) => {
  for (const status of [200, 429]) {
    await page.route("**/auth/v1/recover**", (route) =>
      route.fulfill({
        status,
        json:
          status === 200
            ? {}
            : {
                code: "over_email_send_rate_limit",
                msg: "Provider detail must not reach UI",
              },
      }),
    );
    await page.goto("/forgot-password");
    const submit = page.getByRole("button", {
      name: "Enviar enlace",
      exact: true,
    });
    if (await submit.isDisabled()) {
      await expect(page.getByRole("status")).toContainText(
        "no está disponible",
      );
      return;
    }
    await page.getByLabel("Correo electrónico").fill("controlled@example.test");
    await submit.click();
    await expect(page.getByRole("status")).toContainText(
      "Si existe una cuenta con ese correo",
    );
    await expect(page.getByRole("status")).not.toContainText("Provider detail");
  }
  await assertAccessibility(page);
  await assertUsableViewport(page);
});
test("invalid recovery gives a new-link action without a password form", async ({
  page,
}) => {
  await page.goto("/reset-password?error=expired&next=https://evil.test");
  await expect(page.locator("main").getByRole("alert")).toHaveText(
    "Este enlace ya no es válido. Solicita uno nuevo.",
  );
  await expect(
    page.getByLabel("Nueva contraseña", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Solicitar un nuevo enlace" }),
  ).toHaveAttribute("href", "/forgot-password");
  await expect(page).toHaveURL(/\/reset-password$/);
  await assertAccessibility(page);
});
test("reset preserves symbols, password manager metadata and client confirmation", async ({
  page,
}) => {
  let posted = 0;
  await page.route("**/api/auth/reset-password", async (route) => {
    posted++;
    await route.fulfill({ json: { message: "Contraseña actualizada." } });
  });
  await page.goto("/reset-password?code=fictional-code&next=https://evil.test");
  const password = page.getByLabel("Nueva contraseña", { exact: true }),
    confirmation = page.getByLabel("Confirmar contraseña", { exact: true });
  await expect(password).toHaveAttribute("autocomplete", "new-password");
  const value = 'José O\'Connor "Café" 😊 $9';
  await password.fill(value);
  await confirmation.fill("Wrong-password9");
  await page
    .getByRole("button", { name: "Mostrar nueva contraseña", exact: true })
    .click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue(value);
  await page
    .getByRole("button", { name: "Guardar contraseña", exact: true })
    .click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(
    "Las contraseñas no coinciden.",
  );
  expect(posted).toBe(0);
  await expect(confirmation).toBeFocused();
  await expect(confirmation).toHaveAttribute("aria-invalid", "true");
  await confirmation.fill(value);
  await page
    .getByRole("button", { name: "Guardar contraseña", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Contraseña actualizada",
  );
  expect(posted).toBe(1);
  await expect(
    page.getByRole("link", { name: "Iniciar sesión", exact: true }),
  ).toHaveAttribute("href", "/login");
});
test("used link is rejected cleanly in both themes", async ({ page }) => {
  await page.route("**/api/auth/reset-password", (r) =>
    r.fulfill({ status: 401, json: { error: "This must stay hidden" } }),
  );
  await page.goto("/reset-password?code=fictional-replayed-code");
  await page.getByLabel("Tema", { exact: true }).selectOption("dark");
  await page
    .getByLabel("Nueva contraseña", { exact: true })
    .fill("Fictional new9!");
  await page
    .getByLabel("Confirmar contraseña", { exact: true })
    .fill("Fictional new9!");
  await page
    .getByRole("button", { name: "Guardar contraseña", exact: true })
    .click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Este enlace ya no es válido",
  );
  await expect(
    page.getByLabel("Nueva contraseña", { exact: true }),
  ).toHaveCount(0);
  await assertAccessibility(page);
  await assertUsableViewport(page);
});
