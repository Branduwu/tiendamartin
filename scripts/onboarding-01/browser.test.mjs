// Real AuthForms/contracts/display/controls. Services and transactions are synthetic.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { build } = await import(
  pathToFileURL(
    require.resolve("vite", {
      paths: [path.dirname(require.resolve("vitest/package.json"))],
    }),
  ).href
);
const { chromium } = require(
  require.resolve("playwright", {
    paths: [path.dirname(require.resolve("@playwright/test/package.json"))],
  }),
);
const root = process.cwd(),
  fixture = path.join(root, "scripts/onboarding-01");
const result = await build({
  configFile: false,
  envDir: false,
  root,
  logLevel: "silent",
  resolve: {
    alias: [
      { find: "next/link", replacement: path.join(fixture, "shims.tsx") },
      { find: "next/navigation", replacement: path.join(fixture, "shims.tsx") },
      {
        find: "../../lib/supabase/client",
        replacement: path.join(fixture, "shims.tsx"),
      },
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
  define: { "process.env.NODE_ENV": '"development"' },
  build: {
    write: false,
    minify: false,
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: path.join(fixture, "fixture.tsx"),
      name: "AuthFixture",
      formats: ["iife"],
    },
  },
});
const outputs = (Array.isArray(result) ? result[0] : result).output,
  chunk = outputs.find((x) => x.type === "chunk"),
  css = outputs
    .filter((x) => x.type === "asset" && x.fileName.endsWith(".css"))
    .map((x) => x.source)
    .join("\n");
assert.ok(chunk && css);
assert.ok(
  !Object.keys(chunk.modules).some((x) =>
    /@supabase\/|\/next\/dist\//.test(x.replaceAll("\\", "/")),
  ),
);
const html = `<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body class="retail-ui"><div id="root"></div><script>${chunk.code.replaceAll("</script", "<\\/script")}</script></body></html>`;

const browser = await chromium.launch({ headless: true });
let checks = 0,
  externalRequests = 0;
const pass = (name) => {
  checks++;
  console.log(JSON.stringify({ name, result: "PASS" }));
};
const a = "550e8400-e29b-41d4-a716-446655440001",
  b = "550e8400-e29b-41d4-a716-446655440002";
const permissions = [
  "settings.manage",
  "locations.read",
  "locations.write",
  "products.read",
  "products.write",
  "inventory.read",
  "inventory.receive",
  "cash.read",
  "cash.open",
  "sales.create",
];
const initial = {
  company: true,
  branch: false,
  product: false,
  inventory: false,
  cash: false,
  sale: false,
  team: false,
  taxes: false,
};
async function session({
  state = initial,
  mode = "ok",
  width = 1024,
  compact = false,
  requested = "",
  start = false,
} = {}) {
  const context = await browser.newContext({
      viewport: { width, height: 950 },
    }),
    page = await context.newPage(),
    calls = [],
    errors = [];
  let count = 0,
    release;
  const origin = "http://127.0.0.1:55997";
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.origin === origin && ["/guide", "/start"].includes(u.pathname))
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: html,
      });
    if (u.origin === origin && u.pathname === "/help/first-steps")
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<h1>Guía siguiente</h1>",
      });
    externalRequests++;
    return route.abort();
  });
  await page.exposeFunction("fetchMock", async (url, headers, body) => {
    calls.push({
      url,
      tenant: headers["x-tenant-id"],
      body: body ? JSON.parse(body) : undefined,
    });
    if (url === "/api/v1/tenants")
      return {
        status: 200,
        body: {
          tenants:
            mode === "denied"
              ? [
                  {
                    tenantId: a,
                    tenantName: "Cajero",
                    permissions: ["sales.create"],
                  },
                ]
              : [
                  {
                    tenantId: a,
                    tenantName: "Mi tienda sintética",
                    permissions:
                      mode === "restricted"
                        ? ["settings.manage", "locations.read"]
                        : permissions,
                  },
                  {
                    tenantId: b,
                    tenantName: "Otra tienda sintética",
                    permissions,
                  },
                ],
        },
      };
    if (url === "/api/v1/help/setup") {
      count++;
      if ((mode === "late" || mode === "hold") && headers["x-tenant-id"] === a)
        return new Promise((resolve) => {
          release = () =>
            resolve({ status: 200, body: mode === "hold" ? state : initial });
        });
      if (
        mode === "failed" ||
        (mode === "failed-a" && headers["x-tenant-id"] === a) ||
        (mode === "retry" && count === 1)
      )
        return { status: 503, body: { error: "Fallo sintético" } };
      return {
        status: 200,
        body:
          headers["x-tenant-id"] === b
            ? { ...initial, branch: true, product: true }
            : state,
      };
    }
    if (url === "/api/v1/onboarding")
      return {
        status: body ? 201 : 200,
        body: body
          ? { tenantId: a, locationId: b }
          : { completed: false, tenants: [] },
      };
    if (url === "/api/v1/platform")
      return { status: 403, body: { error: "Sin permiso" } };
    throw Error("UNEXPECTED_API " + url);
  });
  await page.goto(
    origin +
      (start ? "/start" : "/guide") +
      "?compact=" +
      (compact ? "yes" : "no") +
      (requested ? "&tenantId=" + requested : ""),
  );
  return {
    page,
    calls,
    release: () => release?.(),
    close: async () => {
      assert.deepEqual(errors, []);
      await context.close();
    },
  };
}
try {
  const stages = [
    [initial, "Prepara tu primera sucursal", "/inventory"],
    [{ ...initial, branch: true }, "Agrega tu primer producto", "/products"],
    [
      { ...initial, branch: true, product: true },
      "Registra las existencias iniciales",
      "/inventory",
    ],
    [
      { ...initial, branch: true, product: true, inventory: true },
      "Abre tu primer turno de caja",
      "/cash",
    ],
    [
      { ...initial, branch: true, product: true, inventory: true, cash: true },
      "Continúa en Punto de venta",
      "/pos",
    ],
  ];
  for (const [state, title, href] of stages) {
    const s = await session({ state });
    const link = s.page
      .locator(".setup-next")
      .getByRole("link", { name: title, exact: true });
    await link.waitFor();
    assert.equal(await link.getAttribute("href"), href + "?tenantId=" + a);
    assert.ok(
      s.calls
        .filter((c) => c.url === "/api/v1/help/setup")
        .every((c) => c.tenant === a),
    );
    assert.ok(s.calls.every((c) => !c.body));
    pass("next-action-" + href + "-" + title);
    await s.close();
  }
  {
    const s = await session({ mode: "denied" });
    await s.page
      .getByText("La configuración inicial es para", { exact: false })
      .waitFor();
    assert.equal(
      s.calls.filter((c) => c.url === "/api/v1/help/setup").length,
      0,
    );
    assert.equal(await s.page.getByRole("button").count(), 0);
    pass("unauthorized-user-cannot-start-setup-or-create-company");
    await s.close();
  }
  {
    const s = await session({
      mode: "restricted",
      state: { ...initial, branch: true },
    });
    await s.page.getByText("Solicita este paso", { exact: false }).waitFor();
    assert.equal(
      await s.page
        .getByRole("link", { name: "Agrega tu primer producto", exact: true })
        .getAttribute("href"),
      "/help/products?tenantId=" + a,
    );
    assert.equal(await s.page.locator(".setup-next a").count(), 0);
    pass("write-permission-required-for-operation-link");
    await s.close();
  }
  {
    const s = await session({ mode: "retry" });
    await s.page.getByRole("alert").waitFor();
    assert.equal(await s.page.locator(".setup-checklist").count(), 0);
    await s.page.getByRole("button", { name: "Reintentar consulta" }).click();
    await s.page
      .getByRole("heading", { name: "Prepara tu primera sucursal" })
      .waitFor();
    assert.equal(
      s.calls.filter((c) => c.url === "/api/v1/help/setup").length,
      2,
    );
    pass("failure-not-empty-and-explicit-read-only-retry");
    await s.close();
  }
  {
    const s = await session({ mode: "failed", compact: true });
    await s.page.getByRole("alert").waitFor();
    assert.equal(
      await s.page.getByRole("button", { name: "Reintentar consulta" }).count(),
      1,
    );
    pass("compact-dashboard-does-not-hide-setup-error");
    await s.close();
  }
  {
    const s = await session({ mode: "late" });
    await s.page.getByRole("combobox", { name: "Empresa" }).selectOption(b);
    await s.page
      .getByRole("heading", { name: "Registra las existencias iniciales" })
      .waitFor();
    s.release();
    await s.page.waitForTimeout(80);
    assert.equal(
      await s.page.locator(".setup-next a").getAttribute("href"),
      "/inventory?tenantId=" + b,
    );
    assert.equal(
      await s.page.getByText("Otra tienda sintética", { exact: true }).count(),
      2,
    );
    pass("late-response-cannot-overwrite-other-company");
    await s.close();
  }
  {
    const s = await session({ mode: "failed-a" });
    await s.page.getByRole("alert").waitFor();
    await s.page.getByRole("combobox", { name: "Empresa" }).selectOption(b);
    await s.page
      .getByRole("heading", { name: "Registra las existencias iniciales" })
      .waitFor();
    assert.equal(await s.page.getByRole("alert").count(), 0);
    pass("failed-company-never-shows-other-company-progress");
    await s.close();
  }
  {
    const s = await session({ requested: "unassigned-business" });
    await s.page
      .getByText("La configuración inicial es para", { exact: false })
      .waitFor();
    assert.equal(
      s.calls.filter((c) => c.url === "/api/v1/help/setup").length,
      0,
    );
    pass("unassigned-tenant-link-does-not-fallback-to-another-business");
    await s.close();
  }
  {
    const s = await session({
      state: {
        ...initial,
        branch: true,
        product: true,
        inventory: true,
        cash: true,
        sale: true,
      },
      compact: true,
      mode: "hold",
    });
    await s.page.locator("details").waitFor({ state: "visible" });
    s.release();
    await s.page.waitForFunction(() => !document.querySelector("details"));
    assert.equal(await s.page.locator(".setup-next").count(), 0);
    pass("completed-business-hides-compact-guide");
    await s.close();
  }
  for (const width of [1440, 768, 390, 320]) {
    const s = await session({
      width,
      state: { ...initial, branch: true, product: true },
    });
    await s.page
      .getByRole("heading", { name: "Registra las existencias iniciales" })
      .waitFor();
    assert.ok(
      await s.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const size = await s.page.locator(".setup-next a").boundingBox();
    assert.ok(size.height >= 44);
    await s.page.screenshot({
      path: path.join(process.argv[2], `onboarding-${width}.png`),
      fullPage: true,
    });
    pass("responsive-no-overflow-touch-target-" + width);
    await s.close();
  }
  {
    const s = await session({ start: true, width: 390 }),
      p = s.page;
    await p
      .getByLabel("Nombre del negocio", { exact: true })
      .fill("Negocio ficticio");
    await p.getByRole("button", { name: "Continuar", exact: true }).click();
    await p.getByRole("button", { name: "Continuar", exact: true }).click();
    await p.getByRole("button", { name: "Continuar", exact: true }).click();
    await p
      .getByRole("button", { name: "Crear mi empresa", exact: true })
      .click();
    await p.waitForURL("**/help/first-steps");
    const created = s.calls.filter(
      (c) => c.url === "/api/v1/onboarding" && c.body,
    );
    assert.equal(created.length, 1);
    assert.equal(created[0].body.branchName, "Sucursal principal");
    assert.ok(created[0].body.commandId);
    assert.equal("role" in created[0].body, false);
    pass("existing-four-step-onboarding-contract-and-next-guide");
    await s.close();
  }
  assert.equal(externalRequests, 0);
  pass("zero-external-requests");
  console.log(
    JSON.stringify({ checks, externalRequests, realDatabase: false }),
  );
} finally {
  await browser.close();
}
