import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { assertAccessibility, assertUsableViewport } from "./helpers";
type HelpFixture = {
  tenantId: string;
  owner: string;
  cashier: string;
  inventory: string;
  platform: string;
  ticketFile: string;
  inventoryMember?: {
    userId: string;
    displayName: string;
    locationIds: string[];
  };
};
const fixturePath = process.env.E2E_HELP_FIXTURE;
const fixture: HelpFixture | null = fixturePath
  ? JSON.parse(readFileSync(fixturePath, "utf8"))
  : null;
test.beforeEach(() => {
  test.skip(
    !fixture,
    "Controlled help fixture with private storage states required",
  );
});
test.setTimeout(60000);
async function session(
  browser: Browser,
  role: "owner" | "cashier" | "inventory" | "platform",
  mobile: boolean,
): Promise<{ context: BrowserContext; page: Page }> {
  if (!fixture) throw Error("Help fixture missing");
  const context = await browser.newContext({
    storageState: fixture[role],
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    viewport: mobile
      ? { width: 360, height: 800 }
      : { width: 1440, height: 900 },
    hasTouch: mobile,
    isMobile: mobile,
  });
  return { context, page: await context.newPage() };
}
const route = (path: string) => `${path}?tenantId=${fixture!.tenantId}`;
test("owner finds guidance, checks initial progress and submits a safe support request", async ({
  browser,
}, info) => {
  const mobile = info.project.name === "mobile-small",
    { context, page } = await session(browser, "owner", mobile);
  try {
    await page.goto(route("/dashboard"));
    await expect(
      page.getByRole("heading", { name: "Inicio", exact: true }),
    ).toBeVisible();
    await page.goto(route("/help/first-steps"));
    await expect(
      page.getByRole("region", { name: "Progreso de configuración inicial" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Agrega tu primer producto" }),
    ).toBeVisible();
    await assertAccessibility(page);
    await assertUsableViewport(page);
    await page.screenshot({
      path: info.outputPath("initial-setup.png"),
      fullPage: true,
    });
    await page.goto(route("/help"));
    await assertAccessibility(page);
    await assertUsableViewport(page);
    await page.screenshot({
      path: info.outputPath("help-home.png"),
      fullPage: true,
    });
    await page
      .getByRole("searchbox", { name: "Buscar en la guía" })
      .fill("stock minimo");
    await page.getByRole("link", { name: "Stock mínimo y alertas" }).click();
    await expect(page.getByRole("heading", { name: "Qué es" })).toBeVisible();
    await assertAccessibility(page);
    await assertUsableViewport(page);
    await page.goto(route("/help/support"));
    const subject = `SMOKE-UX03C-${info.project.name}-${Date.now()}`;
    await page.getByLabel("Asunto", { exact: true }).fill(subject);
    await page
      .getByLabel("Descripción", { exact: true })
      .fill(
        "Prueba controlada de soporte. <img src=x onerror=alert(1)> se conserva como texto, sin ejecutar.",
      );
    await page.route(
      "**/api/v1/support",
      async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        await route.fetch();
        await route.abort("failed");
      },
      { times: 1 },
    );
    await page
      .getByRole("button", { name: "Enviar solicitud", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "No pudimos confirmar" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        Object.keys(
          JSON.parse(sessionStorage.getItem("smartretail.support.pending.v1")!),
        ),
      ),
    ).toEqual(["tenant", "id"]);
    page.once("dialog", (dialog) => void dialog.accept());
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      "**/api/v1/support/*",
      async (route) => {
        await gate;
        await route.continue();
      },
      { times: 1 },
    );
    await page.reload();
    try {
      await expect(
        page.getByRole("button", { name: "Reintentar solicitud", exact: true }),
      ).toBeDisabled();
    } finally {
      release();
    }
    const detail = page.getByRole("dialog");
    await expect(detail).toBeVisible();
    await expect(detail.getByRole("heading", { name: subject })).toBeVisible();
    await expect(detail.locator("img,script")).toHaveCount(0);
    await assertAccessibility(page);
    await assertUsableViewport(page);
    await page.screenshot({
      path: info.outputPath("support-detail.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Cerrar diálogo" }).click();
    const response = await context.request.get(`/api/v1/support`, {
      headers: { "x-tenant-id": fixture!.tenantId },
    });
    expect(response.status()).toBe(200);
    const list = (await response.json()) as {
      requests: { id: string; subject: string }[];
    };
    const id = list.requests.find((r) => r.subject === subject)?.id;
    expect(id).toBeTruthy();
    writeFileSync(
      `${fixture!.ticketFile}-${info.project.name}.json`,
      JSON.stringify({ id, subject }),
    );
    await page.reload();
    await expect(
      page.getByRole("button", { name: subject, exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
test("cashier sees POS help and correct role without returns or platform access", async ({
  browser,
}, info) => {
  const { context, page } = await session(
    browser,
    "cashier",
    info.project.name === "mobile-small",
  );
  try {
    await page.goto(route("/pos"));
    await expect(
      page.getByRole("heading", { name: "Punto de venta", exact: true }),
    ).toBeVisible();
    const cashGuide = page.getByRole("link", {
      name: /^¿Por qué necesito abrir caja\?/,
    });
    await expect(cashGuide).toBeVisible();
    await expect(cashGuide).toHaveAttribute("href", "/help/cash");
    await expect(cashGuide).toHaveAttribute("rel", "noopener noreferrer");
    await page.getByText("Ayuda del POS", { exact: true }).click();
    await expect(
      page.getByRole("link", { name: "Cómo abrir caja" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Cómo devolver" })).toHaveCount(
      0,
    );
    await page.getByRole("link", { name: "Cómo escanear" }).click();
    await expect(
      page.getByRole("heading", { name: "Escanear un código de barras" }),
    ).toBeVisible();
    await page.goto(route("/help/roles"));
    await expect(
      page.getByRole("heading", { name: "Cajero", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Administrador de SmartRetail",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.goto(route("/help/taxes"));
    await expect(
      page.getByRole("link", { name: "Configurar impuestos", exact: true }),
    ).toHaveCount(0);
    await page.goto(route("/help/support"));
    await expect(
      page.getByRole("heading", { name: "Mis solicitudes", exact: true }),
    ).toBeVisible();
    expect(
      (await context.request.get("/api/v1/platform/support")).status(),
    ).toBe(403);
    const ticket = JSON.parse(
      readFileSync(`${fixture!.ticketFile}-${info.project.name}.json`, "utf8"),
    ) as { id: string };
    expect(
      (
        await context.request.get(`/api/v1/support/${ticket.id}`, {
          headers: { "x-tenant-id": fixture!.tenantId },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await context.request.get("/api/v1/support", {
          headers: { "x-tenant-id": "550e8400-e29b-41d4-a716-446655440099" },
        })
      ).status(),
    ).toBe(403);
    await assertAccessibility(page);
    await assertUsableViewport(page);
  } finally {
    await context.close();
  }
});
test("inventory contextual help supports hover, keyboard dismissal and mobile tap", async ({
  browser,
}, info) => {
  const mobile = info.project.name === "mobile-small",
    { context, page } = await session(browser, "inventory", mobile);
  const manager = fixture?.inventoryMember
    ? (await session(browser, "owner", mobile)).context
    : null;
  const member = fixture?.inventoryMember;
  async function assign(role: "inventory_clerk" | "cashier") {
    if (!manager || !member) return;
    const response = await manager.request.patch(
      `/api/v1/members/${member.userId}`,
      {
        headers: {
          origin: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
          "x-tenant-id": fixture!.tenantId,
        },
        data: {
          role,
          status: "active",
          displayName: member.displayName,
          locationIds: member.locationIds,
        },
      },
    );
    expect(response.status()).toBe(200);
  }
  try {
    await assign("inventory_clerk");
    await page.goto(route("/inventory"));
    const trigger = page.getByRole("button", { name: "Ayuda: Stock mínimo" });
    await expect(trigger).toBeVisible();
    if (mobile) await trigger.tap();
    else {
      const before = await page.evaluate(() => document.activeElement?.tagName);
      await trigger.hover();
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(
        before,
      );
      await expect(
        page.getByRole("dialog", { name: "Stock mínimo", exact: true }),
      ).toBeVisible();
      await page.mouse.move(0, 0);
      await trigger.focus();
    }
    const popup = page.getByRole("dialog", {
      name: "Stock mínimo",
      exact: true,
    });
    await expect(popup).toBeVisible();
    await assertAccessibility(page);
    await assertUsableViewport(page);
    await page.keyboard.press("Escape");
    await expect(popup).not.toBeVisible();
    await expect(trigger).toBeFocused();
    if (mobile) await trigger.tap();
    else {
      await trigger.press("Enter");
    }
    await expect(popup).toBeVisible();
    const guide = popup.getByRole("link", { name: /^Más información/ });
    await expect(guide).toHaveAttribute("href", "/help/minimum-stock");
    const newTab = (await guide.getAttribute("target")) === "_blank";
    const article = newTab
      ? await Promise.all([context.waitForEvent("page"), guide.click()]).then(
          ([opened]) => opened,
        )
      : (await guide.click(), page);
    await expect(
      article.getByRole("heading", {
        name: "Stock mínimo y alertas",
        exact: true,
      }),
    ).toBeVisible();
    await article.screenshot({
      path: info.outputPath("help-article.png"),
      fullPage: true,
    });
    await assertAccessibility(article);
    await assertUsableViewport(article);
  } finally {
    await assign("cashier");
    await manager?.close();
    await context.close();
  }
});
test("authorized platform resolves the created ticket and preserves its content", async ({
  browser,
}, info) => {
  const { context, page } = await session(
    browser,
    "platform",
    info.project.name === "mobile-small",
  );
  try {
    const saved = JSON.parse(
      readFileSync(`${fixture!.ticketFile}-${info.project.name}.json`, "utf8"),
    ) as { id: string; subject: string };
    await page.goto("/platform/support");
    await expect(
      page.getByRole("heading", {
        name: "Soporte de SmartRetail",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: saved.subject, exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Cambiar estado").selectOption("in_progress");
    await expect(dialog.getByLabel("Cambiar estado")).toHaveValue(
      "in_progress",
    );
    await dialog.getByLabel("Cambiar estado").selectOption("closed");
    await expect(dialog.getByLabel("Cambiar estado")).toHaveValue("closed");
    await assertAccessibility(page);
    await assertUsableViewport(page);
    await page.screenshot({
      path: info.outputPath("platform-support.png"),
      fullPage: true,
    });
    const r = await context.request.get(`/api/v1/platform/support/${saved.id}`);
    expect(r.status()).toBe(200);
    expect((await r.json()).status).toBe("closed");
  } finally {
    await context.close();
  }
});
