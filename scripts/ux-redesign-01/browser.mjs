// Real presentation components; all HTTP is intercepted. No Auth or database calls.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { report } from "./report.mjs";
const require = createRequire(import.meta.url);
const { build } = await import(
  pathToFileURL(
    require.resolve("vite", {
      paths: [path.dirname(require.resolve("vitest/package.json"))],
    }),
  )
);
const { chromium } = require(
  require.resolve("playwright", {
    paths: [path.dirname(require.resolve("@playwright/test/package.json"))],
  }),
);
const phase = process.argv[2] ?? "after";
const baseline = process.env.UX_BASELINE_ROOT;
if (phase === "before") {
  assert.ok(
    baseline,
    "Set UX_BASELINE_ROOT to a clean approved f5ac5ac worktree",
  );
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: baseline,
      encoding: "utf8",
    }).trim(),
    "f5ac5ac1232bebdb7ed4b95ed87c3fc06c5d8626",
  );
  assert.equal(
    execFileSync("git", ["status", "--porcelain=v1"], {
      cwd: baseline,
      encoding: "utf8",
    }).trim(),
    "",
  );
}
const root = process.cwd(),
  fixture = path.join(root, "scripts/ux-redesign-01");
const out = process.env.UX_EVIDENCE_DIR;
assert.ok(out, "Set UX_EVIDENCE_DIR outside the repository");
fs.mkdirSync(out, { recursive: true });
const result = await build({
  configFile: false,
  envDir: false,
  root,
  logLevel: "silent",
  resolve: {
    alias: [
      { find: "next/link", replacement: path.join(fixture, "shims.tsx") },
      { find: "next/navigation", replacement: path.join(fixture, "shims.tsx") },
      { find: "./account-controls", replacement: "virtual:account" },
      {
        find: "react-dom",
        replacement: path.join(root, "apps/web/node_modules/react-dom"),
      },
      {
        find: "react",
        replacement: path.join(root, "apps/web/node_modules/react"),
      },
    ],
  },
  plugins: [
    {
      name: "approved-baseline",
      enforce: "pre",
      resolveId(id, importer) {
        if (
          phase === "before" &&
          importer?.endsWith("/fixture.tsx") &&
          id.startsWith("../../apps/")
        ) {
          const target = path.join(baseline, id.slice(6));
          return (fs.existsSync(target) ? target : target + ".tsx").replaceAll(
            "\\",
            "/",
          );
        }
      },
    },
    {
      name: "fixture-account",
      resolveId: (id) => (id === "virtual:account" ? id : undefined),
      load: (id) =>
        id === "virtual:account"
          ? `export {AccountControls as default} from ${JSON.stringify(path.join(fixture, "shims.tsx"))}`
          : undefined,
    },
  ],
  define: { "process.env.NODE_ENV": '"development"' },
  build: {
    write: false,
    minify: false,
    cssCodeSplit: false,
    lib: {
      entry: path.join(fixture, "fixture.tsx"),
      name: "UxFixture",
      formats: ["iife"],
    },
  },
});
const outputs = (Array.isArray(result) ? result[0] : result).output;
const chunk = outputs.find((x) => x.type === "chunk");
assert.ok(
  !Object.keys(chunk.modules).some((x) =>
    /@supabase\/|\/next\/dist\//.test(x.replaceAll("\\", "/")),
  ),
);
const css = outputs
  .filter((x) => x.type === "asset" && x.fileName.endsWith(".css"))
  .map((x) => x.source)
  .join("\n");
const html = `<!doctype html><html lang="es" data-theme="light"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body class="retail-ui"><div id="root"></div><script>${chunk.code.replaceAll("</script", "<\\/script")}</script></body></html>`;
const uid = (n) => `550e8400-e29b-41d4-a716-${String(n).padStart(12, "0")}`,
  tenant = uid(1);
let external = 0,
  checks = 0;
const evidence = [];
const browser = await chromium.launch({ headless: true });
async function session(
  view,
  width = 1366,
  {
    mode = "low",
    manage = true,
    operate = true,
    sell = operate,
    cash = operate,
    inventory = true,
  } = {},
) {
  const context = await browser.newContext({
      viewport: { width, height: 900 },
      colorScheme: "light",
      locale: "es-MX",
      timezoneId: "America/Mexico_City",
    }),
    page = await context.newPage();
  const calls = [],
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const permissions = [
    "reports.read",
    ...(inventory ? ["inventory.read"] : []),
    "products.read",
    ...(sell ? ["sales.create"] : []),
    ...(cash ? ["cash.read"] : []),
    ...(manage
      ? [
          "settings.manage",
          "inventory.minimum.write",
          "products.write",
          "locations.read",
          "locations.write",
          "members.manage",
        ]
      : []),
  ];
  const low = {
    id: uid(41),
    name: "Café molido de prueba",
    sku: "UX-CAFE",
    unit: "piece",
    stock: "2000",
    minimum: "5000",
    suggested: "3000",
    locationId: uid(11),
    locationName: "Sucursal Centro",
    state: "low",
  };
  const alerts =
    mode === "low"
      ? { low: "1", empty: "0", alerts: [low] }
      : { low: "0", empty: "0", alerts: [] };
  const data = report(mode === "zero" ? "zero" : "normal");
  data.inventory = alerts;
  // Underlying catalogue distinguishes the two empty-alert cases; the alerts
  // contract intentionally cannot tell whether every product has a minimum.
  const stock = [
    {
      id: uid(41),
      stock: mode === "zero-no-minimum" ? "0" : "8000",
      minimum: mode === "zero-no-minimum" ? null : "5000",
    },
  ];
  if (mode === "zero-no-minimum") data.products[0].stock = "0";
  await page.route("**/*", (route) => {
    if (
      route.request().isNavigationRequest() &&
      route.request().url().startsWith("http://127.0.0.1:55996/")
    )
      return route.fulfill({ contentType: "text/html", body: html });
    external++;
    return route.abort();
  });
  await page.exposeFunction("uxMock", async (url, init) => {
    calls.push({ url, ...init });
    assert.equal(init.method, "GET");
    const ok = (body) => ({ status: 200, body });
    if (url === "/api/v1/tenants")
      return ok({
        tenants: [
          {
            tenantId: tenant,
            tenantName: "Tienda de prueba",
            tenantStatus: "active",
            role: manage ? "owner" : "cashier",
            permissions,
          },
        ],
      });
    if (url === "/api/v1/platform")
      return { status: 403, body: { error: "No autorizado" } };
    if (url === "/api/v1/help/setup")
      return ok({
        company: true,
        branch: true,
        product: true,
        inventory: true,
        team: false,
        taxes: false,
        cash: true,
        sale: true,
      });
    if (url === "/api/v1/locations")
      return ok({
        locations: [{ id: uid(11), name: "Sucursal Centro", status: "active" }],
      });
    if (url === "/api/v1/inventory") return ok({ stock });
    if (url.startsWith("/api/v1/inventory/alerts?")) return ok(alerts);
    if (url === "/api/v1/reports/options")
      return ok({
        locations: [{ id: uid(11), name: "Sucursal Centro" }],
        products: [],
        suppliers: [],
        customers: [],
      });
    if (url.startsWith("/api/v1/reports?"))
      return ok({
        ...data,
        filters: {
          ...data.filters,
          ...Object.fromEntries(new URLSearchParams(url.split("?")[1])),
        },
      });
    return { status: 404, body: { error: "Unmocked request" } };
  });
  await page.goto("http://127.0.0.1:55996" + view);
  await page.getByRole("heading", { level: 1 }).waitFor();
  if (view === "/dashboard")
    await page.locator(".report-kpis dd").first().waitFor();
  if (view === "/inventory/alerts")
    await page.getByRole("region", { name: "Productos con alerta" }).waitFor();
  await page.getByText("Tienda de prueba", { exact: true }).first().waitFor();
  return { context, page, calls, errors, data, alerts };
}
try {
  for (const width of [1366, 390, 360])
    for (const view of ["/dashboard", "/inventory/alerts", "/help"]) {
      const s = await session(view, width);
      const { page } = s;
      const measurements = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        metrics: [...document.querySelectorAll(".report-kpis dd")].map(
          (x) => x.textContent,
        ),
        firstMetricTop:
          document.querySelector(".report-kpis")?.getBoundingClientRect().top ??
          null,
        helpArticlesTop:
          document.querySelector(".help-categories")?.getBoundingClientRect()
            .top ?? null,
        bodyTop:
          document.querySelector("main")?.getBoundingClientRect().top ?? null,
      }));
      const name =
        (view === "/dashboard"
          ? "inicio"
          : view === "/help"
            ? "ayuda"
            : "alertas") +
        "-" +
        width;
      await page.screenshot({
        path: path.join(out, `${phase}-${name}.png`),
        fullPage: true,
      });
      evidence.push({ name, ...measurements });
      if (phase === "after") {
        assert.equal(measurements.overflow, false, name + " overflow");
        assert.deepEqual(s.errors, []);
        checks++;
        if (view === "/dashboard") {
          await page
            .getByRole("link", { name: "Ir al punto de venta", exact: true })
            .waitFor();
          assert.ok(
            (
              await page
                .getByRole("link", {
                  name: "Ir al punto de venta",
                  exact: true,
                })
                .boundingBox()
            ).y < 500,
          );
          await page
            .getByRole("link", { name: "Revisar caja", exact: true })
            .waitFor();
          await page
            .getByText("Solo productos con mínimo configurado", {
              exact: false,
            })
            .first()
            .waitFor();
          checks++;
        }
        if (view === "/help") {
          assert.ok(measurements.helpArticlesTop < 650);
          checks++;
        }
        if (width !== 1366) {
          await page.getByRole("button", { name: "Menú", exact: true }).focus();
          await page.keyboard.press("Enter");
        }
        const help =
          width === 1366
            ? page
                .getByRole("navigation", { name: "Principal" })
                .getByRole("link", { name: "Ayuda", exact: true })
            : page
                .getByRole("navigation", { name: "Menú móvil" })
                .getByRole("link", { name: "Ayuda", exact: true });
        await help.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        assert.equal(
          await help.evaluate((e) => e === document.activeElement),
          true,
        );
        await page.keyboard.press("Enter");
        await page
          .getByRole("heading", { name: "Ayuda", exact: true })
          .waitFor();
        checks++;
      }
      await s.context.close();
    }
  if (phase === "after") {
    const filters = await session("/dashboard");
    await filters.page.getByText("Fechas y filtros", { exact: true }).click();
    await filters.page.locator('select[name="period"]').selectOption("7d");
    await filters.page
      .locator('select[name="locationId"]')
      .selectOption(uid(11));
    await filters.page
      .getByRole("button", { name: "Aplicar filtros", exact: true })
      .click();
    await filters.page.waitForFunction(() =>
      document.querySelector(".report-kpis dd"),
    );
    assert.ok(
      filters.calls.some((c) => c.url.startsWith("/api/v1/reports?period=7d")),
    );
    assert.ok(
      filters.calls
        .filter((c) => c.url.startsWith("/api/v1/reports"))
        .every((c) => c.headers["x-tenant-id"] === tenant),
    );
    for (const label of [
      "Revisar existencias",
      "Configurar mínimos",
      "Ver alertas y reabastecimiento",
    ]) {
      const link = filters.page.getByRole("link", { name: label, exact: true });
      assert.equal(
        new URL(
          await link.getAttribute("href"),
          "http://127.0.0.1",
        ).searchParams.get("locationId"),
        uid(11),
      );
    }
    await filters.context.close();
    checks++;
    for (const [sell, cash, inventory] of [
      [true, false, true],
      [false, true, true],
      [false, false, false],
    ]) {
      const s = await session("/dashboard", 390, {
        manage: false,
        sell,
        cash,
        inventory,
      });
      assert.equal(
        await s.page
          .getByRole("link", { name: "Ir al punto de venta", exact: true })
          .count(),
        sell ? 1 : 0,
      );
      assert.equal(
        await s.page
          .getByRole("link", { name: "Revisar caja", exact: true })
          .count(),
        cash ? 1 : 0,
      );
      assert.equal(
        await s.page
          .getByRole("link", { name: "Revisar existencias", exact: true })
          .count(),
        inventory ? 1 : 0,
      );
      assert.equal(
        await s.page
          .getByRole("link", {
            name: "Ver alertas y reabastecimiento",
            exact: true,
          })
          .count(),
        inventory ? 1 : 0,
      );
      await s.context.close();
      checks++;
    }
    for (const width of [1366, 390]) {
      const s = await session("/help?locked=1", width);
      if (width === 390)
        await s.page.getByRole("button", { name: "Menú", exact: true }).click();
      const nav = s.page.getByRole("navigation", {
        name: width === 1366 ? "Principal" : "Menú móvil",
      });
      assert.equal(
        await nav.getByRole("link", { name: "Ayuda", exact: true }).count(),
        0,
      );
      assert.equal(
        await nav
          .getByText("Ayuda", { exact: true })
          .getAttribute("aria-disabled"),
        "true",
      );
      if (width === 390) {
        await s.page.keyboard.press("Escape");
        assert.equal(await s.page.getByRole("dialog").isVisible(), false);
      }
      await s.context.close();
      checks++;
    }
    for (const mode of ["zero", "configured-clear", "zero-no-minimum"]) {
      const s = await session("/dashboard", 390, {
        mode,
        manage: false,
        operate: false,
      });
      assert.equal(
        await s.page
          .getByRole("link", { name: "Ir al punto de venta", exact: true })
          .count(),
        0,
      );
      if (mode === "zero") {
        await s.page
          .getByText("Sin ventas ni devoluciones en este periodo.", {
            exact: true,
          })
          .waitFor();
        assert.deepEqual(
          await s.page.locator(".report-kpis dd").allTextContents(),
          ["$0.00 MXN", "0", "$0.00 MXN", "$0.00 MXN"],
        );
      }
      if (mode === "zero-no-minimum") {
        const underlying = await s.page.evaluate(async () =>
          (await fetch("/api/v1/inventory")).json(),
        );
        assert.equal(underlying.stock[0].stock, "0");
        assert.equal(underlying.stock[0].minimum, null);
      }
      assert.equal(
        await s.page
          .getByRole("link", { name: "Revisar caja", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await s.page
          .getByText("No hay productos agotados ni con stock bajo.", {
            exact: true,
          })
          .count(),
        0,
      );
      await s.context.close();
      checks++;
    }
    for (const manage of [true, false])
      for (const mode of ["low", "zero-no-minimum", "configured-clear"]) {
        const s = await session("/inventory/alerts", 390, { mode, manage });
        const p = s.page;
        await p
          .getByText("Sin mínimo no hay alerta automática.", { exact: false })
          .waitFor();
        assert.equal(
          await p
            .getByRole("link", { name: "Configurar mínimos", exact: true })
            .count(),
          manage ? 1 : 0,
        );
        const expected = mode === "low" ? ["1", "0"] : ["0", "0"];
        assert.deepEqual(
          await p.locator(".report-kpis dd").allTextContents(),
          expected,
        );
        checks++;
        await s.context.close();
      }
    const before = JSON.parse(
      fs.readFileSync(path.join(out, "before.json"), "utf8"),
    );
    for (const row of evidence) {
      const base = before.views.find((x) => x.name === row.name);
      assert.deepEqual(
        row.metrics,
        base.metrics,
        "Business figures unchanged " + row.name,
      );
      if (row.name.startsWith("inicio"))
        assert.ok(row.firstMetricTop < base.firstMetricTop, "Metrics move up");
      if (row.name.startsWith("ayuda"))
        assert.ok(
          row.helpArticlesTop < base.helpArticlesTop,
          `Help moves up ${row.name}: ${base.helpArticlesTop} -> ${row.helpArticlesTop}`,
        );
      checks++;
    }
  }
  assert.equal(external, 0);
  fs.writeFileSync(
    path.join(out, phase + ".json"),
    JSON.stringify(
      { phase, checks, externalRequests: external, views: evidence },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      phase,
      checks,
      screenshots: evidence.length,
      externalRequests: external,
    }),
  );
} finally {
  await browser.close();
}
