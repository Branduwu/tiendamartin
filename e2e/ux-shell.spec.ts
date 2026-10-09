import { test, expect } from "@playwright/test";
import { assertAccessibility, assertUsableViewport } from "./helpers";
test("theme choice persists across reload and remains accessible", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Tema", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.getByLabel("Tema", { exact: true })).toHaveValue("dark");
  await assertAccessibility(page);
  await assertUsableViewport(page);
  await page.getByLabel("Tema", { exact: true }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await assertAccessibility(page);
});
test("system is the default and follows changes in system preference", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/register");
  await expect(page.getByLabel("Tema", { exact: true })).toHaveValue("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await assertAccessibility(page);
});
test("invalid theme data and unavailable storage do not break authentication UI", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("smartretail.theme.v1", "invalid");
    Storage.prototype.setItem = () => {
      throw new Error("Storage blocked");
    };
  });
  await page.goto("/login");
  await expect(page.getByLabel("Tema", { exact: true })).toHaveValue("system");
  await page.getByLabel("Tema", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "Iniciar sesión", exact: true }),
  ).toBeVisible();
});
