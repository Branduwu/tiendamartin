// Only in-memory synthetic services; every external request is blocked.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  fixturePolicy,
  cspHtml,
  observePolicy,
  assertPolicyClean,
} from "../csp-01/fixture-policy.mjs";
const require = createRequire(import.meta.url),
  root = process.cwd();
const phase = process.argv[2] ?? "after",
  before = phase === "before";
const evidence = process.env.OPERATIONAL_UX_EVIDENCE_DIR;
assert.ok(evidence && !path.resolve(evidence).startsWith(root));
fs.mkdirSync(evidence, { recursive: true });
const baseline = process.env.OPERATIONAL_UX_BASELINE_ROOT;
if (before) {
  assert.ok(baseline);
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: baseline,
      encoding: "utf8",
    }).trim(),
    "7803d2788f5e7f350a96dfc89749f9f6ace3d625",
  );
}
const policy = await fixturePolicy();
if (!before)
  assert.equal(
    policy?.header,
    "content-security-policy",
    "After verification requires an Enforced policy from the local production server",
  );
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
const stub = path.join(root, "scripts/pos-ux-01/shims.tsx");
const result = await build({
  configFile: false,
  envDir: false,
  root,
  logLevel: "silent",
  plugins: [
    {
      name: "approved-baseline",
      enforce: "pre",
      resolveId(id, importer) {
        if (
          before &&
          importer?.endsWith("/ux-redesign-04/fixture.tsx") &&
          id.startsWith("../../apps/")
        ) {
          const file = path.join(baseline, id.slice(6));
          return (
            fs.existsSync(file)
              ? file
              : file + (id.endsWith("instrumentation-client") ? ".ts" : ".tsx")
          ).replaceAll("\\", "/");
        }
      },
    },
  ],
  resolve: {
    alias: [
      {
        find: "@smartretail/contracts/browser-csp",
        replacement: path.join(root, "packages/contracts/src/browser-csp.ts"),
      },
      ...["contracts", "application", "domain"].map((name) => ({
        find: new RegExp(`^@smartretail/${name}$`),
        replacement: path.join(root, `packages/${name}/src/index.ts`),
      })),
      {
        find: /^zod$/,
        replacement: path.join(
          root,
          "packages/contracts/node_modules/zod/index.js",
        ),
      },
      ...[
        "next/dynamic",
        "../components/smart-scanner",
        "../components/app-navigation",
        "../components/business-context",
        "../components/pos-customer-selector",
        "../components/pos-credit",
        "../components/product-thumbnails",
      ].map((find) => ({ find, replacement: stub })),
      ...["next/link", "next/navigation"].map((find) => ({
        find,
        replacement: path.join(root, "scripts/ux-redesign-02/shims.tsx"),
      })),
      ...["react-dom", "react"].map((find) => ({
        find,
        replacement: path.join(root, "apps/web/node_modules", find),
      })),
    ],
  },
  define: { "process.env.NODE_ENV": '"production"' },
  build: {
    write: false,
    minify: false,
    cssCodeSplit: false,
    lib: {
      entry: path.join(root, "scripts/ux-redesign-04/fixture.tsx"),
      name: "OperationalFixture",
      formats: ["iife"],
    },
  },
});
const output = (Array.isArray(result) ? result[0] : result).output;
const chunk = output.find((x) => x.type === "chunk"),
  css = output
    .filter((x) => x.type === "asset" && x.fileName.endsWith(".css"))
    .map((x) => x.source)
    .join("\n");
assert.ok(
  !Object.keys(chunk.modules).some((x) =>
    /@supabase\/|\/next\/dist\//.test(x.replaceAll("\\", "/")),
  ),
);
const html = `<!doctype html><html lang="es" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SmartRetail - Operación sintética</title><style>${css}</style></head><body class="retail-ui"><div id="root"></div><script>${chunk.code.replaceAll("</script", "<\\/script")}</script></body></html>`;
const uid = (n) => `550e8400-e29b-41d4-a716-${String(n).padStart(12, "0")}`;
const tenant = uid(1),
  actor = uid(2),
  location = uid(3),
  money = (n) => ({ currency: "MXN", minorUnits: String(n) });
const products = [
  {
    id: uid(10),
    name: "Café de prueba",
    sku: "CAFE-TEST",
    unit: "piece",
    salePrice: money(2500),
    purchaseCost: money(1000),
    status: "active",
  },
  {
    id: uid(11),
    name: "Agua sin existencias",
    sku: "AGUA-TEST",
    unit: "piece",
    salePrice: money(1500),
    purchaseCost: money(500),
    status: "active",
  },
];
const locations = Array.from({ length: 11 }, (_, i) => ({
  id: i === 0 ? location : uid(30 + i),
  code: `S${i + 1}`,
  name: `Sucursal ${i + 1}`,
  status: "active",
}));
const recorded = {
  tenantId: tenant,
  locationId: location,
  shiftId: uid(4),
  createdBy: actor,
  createdAt: "2026-10-28T16:00:00Z",
  payments: [{ method: "cash", amount: money(2000) }],
  sale: {
    id: uid(5),
    status: "completed",
    total: money(5000),
    lines: [
      {
        productId: products[0].id,
        name: products[0].name,
        sku: products[0].sku,
        unit: "piece",
        quantity: { unit: "piece", milliUnits: "2000" },
        unitPrice: money(2500),
        lineTotal: money(5000),
      },
    ],
  },
};
const receivable = {
  id: uid(6),
  tenantId: tenant,
  saleId: recorded.sale.id,
  customerId: uid(7),
  customerName: "Cliente sintético",
  locationId: location,
  originalAmount: money(10000),
  paidAmount: money(2500),
  returnedAmount: money(1500),
  outstandingAmount: money(6000),
  status: "partially_paid",
  createdAt: recorded.createdAt,
};
const ticket = {
  id: uid(8),
  tenantId: tenant,
  tenantName: "Empresa de prueba",
  createdBy: actor,
  createdByName: "Persona de prueba",
  createdByRole: "owner",
  category: "error",
  status: "open",
  pagePath: "/pos",
  subject: "Consulta de prueba " + "ReferenciaLargaSinEspacios".repeat(8),
  description: "Descripción sintética: " + "ReferenciaSinEspacios".repeat(35),
  createdAt: recorded.createdAt,
  updatedAt: recorded.createdAt,
};
const browser = await chromium.launch({ headless: true });
let checks = 0,
  external = 0;
const pass = (name) => {
  checks++;
  console.log(JSON.stringify({ name, result: "PASS" }));
};
async function session(route, width, mode = "normal") {
  const context = await browser.newContext({
    viewport: { width, height: 960 },
    serviceWorkers: "block",
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
    colorScheme: "light",
  });
  const calls = [];
  let release;
  await context.route("**/*", (r) => {
    if (r.request().url() === `http://127.0.0.1:55994${route}`)
      return r.fulfill({
        contentType: "text/html",
        body: cspHtml(html, policy),
        ...(policy ? { headers: { [policy.header]: policy.value } } : {}),
      });
    external++;
    return r.abort();
  });
  await context.addInitScript(
    (data) => {
      window.fixtureData = data;
    },
    { recorded, locations, tenant, actor },
  );
  if (mode === "pending-return") {
    await context.addInitScript(
      ({ key, command }) =>
        sessionStorage.setItem(key, JSON.stringify(command)),
      {
        key: `smartretail.pending-return.${actor}.${tenant}.${recorded.sale.id}`,
        command: {
          id: uid(70),
          lines: [
            {
              saleLineId: products[0].id,
              productId: products[0].id,
              quantity: { unit: "piece", milliUnits: "1000" },
              movementId: uid(71),
            },
          ],
          refunds: [],
        },
      },
    );
  }
  await context.exposeFunction("operationalMock", async (url, init) => {
    calls.push({ url, ...init });
    const ok = (body) => ({ status: 200, body });
    if (url === "/api/v1/tenants")
      return ok({
        tenants: [
          {
            tenantId: tenant,
            tenantName: "Empresa de prueba",
            tenantStatus: "active",
            role: "owner",
            permissions: [
              "sales.create",
              "sales.read",
              "inventory.read",
              "receivables.read",
              "receivables.collect",
            ],
          },
        ],
      });
    if (url === "/api/v1/products") return ok({ products });
    if (url === "/api/v1/locations") return ok({ locations: [locations[0]] });
    if (url.startsWith("/api/v1/inventory?"))
      return ok({
        stock: products.map((p, i) => ({
          productId: p.id,
          locationId: location,
          quantity: { unit: p.unit, milliUnits: i === 0 ? "5000" : "0" },
        })),
      });
    if (url.startsWith("/api/v1/cash?"))
      return ok({ shift: { id: uid(4), status: "open" } });
    if (url === "/api/v1/sales/quote") {
      const body = JSON.parse(init.body);
      return ok({ sale: { ...body.draft, status: "completed" }, taxes: [] });
    }
    if (url === "/api/v1/receivables" || url.startsWith("/api/v1/receivables?"))
      return ok({ receivables: [receivable], nextCursor: null });
    if (url === "/api/v1/support?page=1")
      return ok({ requests: [ticket], hasMore: false });
    if (url === `/api/v1/support/${ticket.id}`) {
      if (mode === "held")
        await new Promise((resolve) => {
          release = resolve;
        });
      if (mode === "read-error")
        return { status: 503, body: { error: "Consulta no disponible" } };
      return ok(ticket);
    }
    if (url === "/api/v1/support" && init.method === "POST") {
      assert.equal(init.headers["x-tenant-id"], tenant);
      await new Promise((resolve) => {
        release = resolve;
      });
      return ok({ ...ticket, ...JSON.parse(init.body) });
    }
    throw new Error(`Unexpected synthetic service: ${init.method} ${url}`);
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await observePolicy(page);
  await page.goto(`http://127.0.0.1:55994${route}`);
  return {
    page,
    calls,
    release: () => release?.(),
    close: async () => {
      assert.deepEqual(errors, []);
      await assertPolicyClean(page);
      await context.close();
    },
  };
}
async function capture(s, name, width) {
  await s.page.screenshot({
    path: path.join(evidence, `${phase}-${name}-${width}.png`),
    fullPage: true,
  });
}
async function accessible(page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    result.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
    [],
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "No horizontal page overflow",
  );
}
const mutations = (s) =>
  s.calls.filter((c) => c.method !== "GET" && c.url !== "/api/v1/sales/quote");
try {
  for (const width of [1366, 768, 390, 360]) {
    {
      const s = await session("/pos", width),
        p = s.page;
      await p.getByText("Sin existencias", { exact: true }).waitFor();
      await capture(s, "pos", width);
      if (!before) {
        assert.equal(
          await p
            .getByRole("button", {
              name: "Agregar Agua sin existencias",
              exact: true,
            })
            .isDisabled(),
          true,
        );
        assert.ok(
          await p.getByText(/Registra una entrada de inventario/).isVisible(),
        );
        await p
          .getByRole("button", { name: "Agregar Café de prueba", exact: true })
          .click();
        if (width <= 760)
          await p.getByRole("button", { name: /Ver carrito:/ }).click();
        await p
          .getByRole("textbox", {
            name: "Cantidad de Café de prueba",
            exact: true,
          })
          .waitFor();
        assert.equal(
          await p
            .getByRole("textbox", {
              name: "Cantidad de Café de prueba",
              exact: true,
            })
            .inputValue(),
          "1",
        );
        assert.equal(mutations(s).length, 0);
        await expect(
          p
            .locator(".pos-totals > div")
            .filter({ has: p.getByText("Total", { exact: true }) })
            .locator("dd"),
        ).toHaveText("$25.00 MXN");
        await accessible(p);
        pass(`pos-zero-positive-and-unchanged-price-${width}`);
      }
      await s.close();
    }
    {
      const s = await session("/sales/ticket", width),
        p = s.page;
      const trigger = p.getByRole("button", {
        name: "Devolver productos",
        exact: true,
      });
      await trigger.click();
      await p.getByLabel("Cantidad a devolver (Café de prueba)").fill("2");
      await capture(s, "returns", width);
      if (!before) {
        const summary = p.getByRole("region", {
          name: "Resumen de la devolución",
        });
        assert.match(await summary.innerText(), /\$50\.00 MXN/);
        assert.match(await summary.innerText(), /\$30\.00 MXN/);
        assert.match(await summary.innerText(), /\$20\.00 MXN/);
        await accessible(p);
        await p.getByRole("button", { name: "Cancelar", exact: true }).click();
        await trigger.waitFor();
        await expect(trigger).toBeFocused();
        assert.equal(await p.locator("form").count(), 0);
        assert.equal(mutations(s).length, 0);
        await trigger.click();
        assert.equal(
          await p
            .getByLabel("Cantidad a devolver (Café de prueba)")
            .inputValue(),
          "0",
        );
        pass(`return-preview-amounts-cancel-reset-focus-no-mutation-${width}`);
      }
      await s.close();
    }
    {
      const s = await session("/receivables", width),
        p = s.page;
      await p.getByText("Cliente sintético", { exact: true }).waitFor();
      if (!before) {
        await p.getByText("Desglose del saldo", { exact: true }).click();
        const dl = p.locator("td[data-label='Pendiente'] dl");
        const amounts = await dl.locator("dd").allTextContents();
        assert.deepEqual(amounts, [
          "$100.00 MXN",
          "− $25.00 MXN",
          "− $15.00 MXN",
          "$60.00 MXN",
        ]);
        await accessible(p);
        assert.equal(mutations(s).length, 0);
        pass(`receivable-original-payment-return-balance-${width}`);
      }
      await capture(s, "receivables", width);
      await s.close();
    }
    {
      const s = await session("/help/support", width, "held"),
        p = s.page;
      const trigger = p.getByRole("button", {
        name: ticket.subject,
        exact: true,
      });
      await trigger.click();
      if (!before) {
        await p
          .getByRole("status")
          .filter({ hasText: "Cargando solicitud…" })
          .waitFor();
        assert.equal(
          await p.getByText("Enviando…", { exact: true }).isVisible(),
          false,
        );
      }
      s.release();
      await p.getByRole("dialog").waitFor();
      await capture(s, "support", width);
      if (!before) {
        await accessible(p);
        assert.ok(
          await p
            .getByRole("dialog")
            .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        );
        await p.keyboard.press("Escape");
        await p.getByRole("dialog").waitFor({ state: "hidden" });
        await expect(trigger).toBeFocused();
        await trigger.press("Enter");
        await p.getByText("Cargando solicitud…", { exact: true }).waitFor();
        s.release();
        await p.getByRole("dialog").waitFor();
        await expect(
          p.getByRole("button", { name: "Cerrar diálogo" }),
        ).toBeFocused();
        await p.keyboard.press("Tab");
        // Native modal dialogs may visit browser chrome between tab cycles.
        if (await p.evaluate(() => document.activeElement === document.body))
          await p.keyboard.press("Tab");
        assert.equal(
          await p
            .getByRole("dialog")
            .evaluate((el) => el.contains(document.activeElement)),
          true,
        );
        await p.getByRole("button", { name: "Cerrar diálogo" }).click();
        await p.getByRole("dialog").waitFor({ state: "hidden" });
        await expect(trigger).toBeFocused();
        assert.equal(mutations(s).length, 0);
        pass(`support-read-label-escape-close-focus-overflow-${width}`);
      }
      await s.close();
    }
  }
  if (!before) {
    {
      const s = await session("/sales/ticket", 390, "pending-return"),
        p = s.page;
      await p.getByRole("button", { name: "Cancelar", exact: true }).waitFor();
      assert.equal(
        await p
          .getByRole("button", { name: "Cancelar", exact: true })
          .isDisabled(),
        true,
      );
      assert.ok(
        await p
          .getByText(/No se puede descartar una operación pendiente/)
          .isVisible(),
      );
      const key = `smartretail.pending-return.${actor}.${tenant}.${recorded.sale.id}`;
      assert.equal(
        JSON.parse(await p.evaluate((k) => sessionStorage.getItem(k), key)).id,
        uid(70),
      );
      assert.equal(mutations(s).length, 0);
      pass("uncertain-return-cannot-be-discarded-or-duplicated");
      await s.close();
    }
    {
      const s = await session("/sales/ticket", 390),
        p = s.page;
      await p
        .getByRole("button", { name: "Devolver productos", exact: true })
        .click();
      await p.getByLabel("Cantidad a devolver (Café de prueba)").fill("3");
      await p
        .getByRole("alert")
        .filter({ hasText: /Revisa las cantidades/ })
        .waitFor();
      assert.equal(
        await p
          .getByRole("button", { name: "Registrar devolución", exact: true })
          .isDisabled(),
        true,
      );
      await p.getByRole("button", { name: "Cancelar", exact: true }).click();
      assert.equal(mutations(s).length, 0);
      pass("invalid-return-preview-cancel-without-mutation");
      await s.close();
    }
    {
      const s = await session("/help/support", 390, "read-error"),
        p = s.page;
      await p
        .getByRole("button", { name: ticket.subject, exact: true })
        .click();
      await p
        .getByRole("alert")
        .filter({ hasText: "Consulta no disponible" })
        .waitFor();
      assert.equal(await p.getByRole("dialog").count(), 0);
      await expect(
        p.getByRole("button", { name: "Enviar solicitud", exact: true }),
      ).toBeEnabled();
      assert.equal(mutations(s).length, 0);
      pass("support-read-error-never-sends");
      await s.close();
    }
    const s = await session("/selector", 390),
      p = s.page;
    await p
      .getByText("0 seleccionadas · Elegir sucursales", { exact: true })
      .click();
    await p.getByLabel("Sucursal 1", { exact: true }).check();
    assert.equal(
      await p
        .getByText("1 seleccionada · Elegir sucursales", { exact: true })
        .count(),
      1,
    );
    assert.ok(await p.getByText(/1 de 11 seleccionada\./).isVisible());
    await p.getByLabel("Sucursal 2", { exact: true }).check();
    assert.equal(
      await p
        .getByText("2 seleccionadas · Elegir sucursales", { exact: true })
        .count(),
      1,
    );
    await accessible(p);
    pass("shared-selector-zero-one-multiple");
    await s.close();
    const q = await session("/help/support", 390),
      r = q.page;
    const oldTicket = r.getByRole("button", {
      name: ticket.subject,
      exact: true,
    });
    await oldTicket.click();
    await r.getByRole("dialog").waitFor();
    await r.keyboard.press("Escape");
    await expect(oldTicket).toBeFocused();
    await r.getByLabel("Asunto", { exact: true }).fill("Solicitud sintética");
    await r
      .getByLabel("Descripción", { exact: true })
      .fill("Solo se prueba el estado de envío con transporte simulado.");
    await r
      .getByRole("button", { name: "Enviar solicitud", exact: true })
      .click();
    await r.getByText("Enviando…", { exact: true }).waitFor();
    assert.equal(
      await r.getByText("Cargando solicitud…", { exact: true }).count(),
      0,
    );
    q.release();
    await r.getByRole("dialog").waitFor();
    assert.equal(mutations(q).length, 1);
    await r.getByRole("button", { name: "Cerrar diálogo" }).click();
    await expect(
      r.getByRole("button", { name: "Enviar solicitud", exact: true }),
    ).toBeFocused();
    pass("send-label-only-during-simulated-post");
    await q.close();
  }
  assert.equal(external, 0);
  fs.writeFileSync(
    path.join(evidence, `${phase}-result.json`),
    JSON.stringify(
      {
        phase,
        checks,
        externalRequests: external,
        csp: policy?.header ?? "not tested",
        viewports: [1366, 768, 390, 360],
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ phase, checks, externalRequests: external }));
} finally {
  await browser.close();
}
