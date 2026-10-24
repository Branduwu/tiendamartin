// Real CashPanel/contracts/display/controls. Services and transactions are synthetic.
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
  fixture = path.join(root, "scripts/caja-ux-01");
const result = await build({
  configFile: false,
  envDir: false,
  root,
  logLevel: "silent",
  resolve: {
    alias: [
      {
        find: "../components/app-navigation",
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
      name: "CashFixture",
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
const tenant = "550e8400-e29b-41d4-a716-446655440001",
  location = "550e8400-e29b-41d4-a716-446655440011",
  otherLocation = "550e8400-e29b-41d4-a716-446655440012",
  user = "550e8400-e29b-41d4-a716-446655440020",
  shiftId = "550e8400-e29b-41d4-a716-446655440030";
const money = (v) => ({ currency: "MXN", minorUnits: String(v) });
const baseShift = () => ({
  id: shiftId,
  tenantId: tenant,
  locationId: location,
  openedBy: user,
  openedByName: "Ana de prueba",
  openedAt: "2026-10-24T12:00:00.000Z",
  openingCash: money(10000),
  status: "open",
  salesCash: money(5000),
  cashIn: money(2000),
  cashOut: money(1000),
  expectedCash: money(16000),
  closedBy: null,
  closedAt: null,
  countedCash: null,
  difference: null,
});
const browser = await chromium.launch({ headless: true });
let externalRequests = 0,
  checks = 0;
const pass = (name) => {
  checks++;
  console.log(JSON.stringify({ name, result: "PASS" }));
};
async function session(mode = "open", width = 1440, height = 1000) {
  const context = await browser.newContext({
    viewport: { width, height },
    serviceWorkers: "block",
  });
  await context.route("**/*", (route) => {
    if (route.request().url() === "http://127.0.0.1:55994/")
      return route.fulfill({ contentType: "text/html", body: html });
    externalRequests++;
    return route.abort();
  });
  let shift = mode === "none" ? null : baseShift(),
    readFailed = false,
    uncertain = false,
    holdMutation = null,
    releaseMutation = null,
    holdHistory = null,
    releaseHistory = null;
  if (mode.startsWith("closed"))
    shift = {
      ...shift,
      status: "closed",
      closedAt: "2026-10-24T13:00:00.000Z",
      closedBy: user,
      closedByName: "Luis de prueba",
      countedCash: money(
        mode === "closed-zero"
          ? 16000
          : mode === "closed-surplus"
            ? 16100
            : 15950,
      ),
      difference: money(
        mode === "closed-zero" ? 0 : mode === "closed-surplus" ? 100 : -50,
      ),
    };
  if (mode === "closed-large")
    shift = {
      ...shift,
      expectedCash: money("9007199254740994"),
      countedCash: money(1),
      difference: money("-9007199254740993"),
    };
  const calls = [],
    records = new Map(),
    movements = [
      {
        id: "550e8400-e29b-41d4-a716-446655440050",
        shiftId,
        type: "cash_out",
        amount: money(1000),
        reason:
          "Retiro de efectivo para depósito con concepto detallado de prueba",
        createdBy: user,
        createdAt: "2026-10-24T12:30:00.000Z",
      },
    ];
  function history() {
    return {
      shifts: shift
        ? [
            {
              id: shift.id,
              status: shift.status,
              openedAt: shift.openedAt,
              openedByName: shift.openedByName,
              closedAt: shift.closedAt,
              openingCash: shift.openingCash,
              countedCash: shift.countedCash,
              difference: shift.difference,
            },
          ]
        : [],
      movements: shift ? movements : [],
    };
  }
  await context.exposeFunction("cashMock", async (url, init) => {
    calls.push({ url, ...init });
    if (url === "/api/v1/tenants")
      return {
        status: 200,
        body: {
          tenants:
            mode === "no-access"
              ? []
              : [
                  {
                    tenantId: tenant,
                    tenantName: "Empresa ficticia",
                    displayName: "Usuario actual de prueba",
                    permissions: [
                      "cash.read",
                      "cash.open",
                      "cash.move",
                      "cash.close",
                    ],
                  },
                ],
        },
      };
    assert.equal(init.headers["x-tenant-id"], tenant);
    if (url === "/api/v1/locations")
      return {
        status: 200,
        body: {
          locations: [
            {
              id: location,
              name: "Sucursal Centro",
              code: "CENTRO",
              status: "active",
            },
            {
              id: otherLocation,
              name: "Otra ubicación",
              code: "OTRA",
              status: "active",
            },
          ],
        },
      };
    const u = new URL(url, "http://127.0.0.1:55994");
    if (u.pathname === "/api/v1/cash/history") {
      if (holdHistory && u.searchParams.get("locationId") === location)
        await holdHistory;
      if (mode === "history-error")
        return { status: 503, body: { error: "Lectura no disponible" } };
      return {
        status: 200,
        body: {
          history:
            u.searchParams.get("locationId") === otherLocation
              ? { shifts: [], movements: [] }
              : history(),
        },
      };
    }
    if (u.pathname === "/api/v1/cash" && init.method === "GET") {
      if (mode === "read-error" && !readFailed) {
        readFailed = true;
        return { status: 503, body: { error: "Lectura no disponible" } };
      }
      return {
        status: 200,
        body: {
          shift:
            u.searchParams.get("locationId") === otherLocation ? null : shift,
        },
      };
    }
    if (init.method === "POST") {
      const op = u.pathname.split("/").at(-1),
        command = JSON.parse(init.body),
        key = op + ":" + (command.id ?? command.shiftId);
      if (mode === "conflict")
        return {
          status: 409,
          body: {
            error:
              "El turno cambió o el efectivo es insuficiente. Actualiza la caja.",
          },
        };
      const previous = records.get(key);
      let response;
      if (previous) {
        assert.deepEqual(command, previous.command);
        response = previous.response;
      } else {
        if (op === "open") {
          shift = {
            ...baseShift(),
            id: command.id,
            openingCash: command.openingCash,
            salesCash: money(0),
            cashIn: money(0),
            cashOut: money(0),
            expectedCash: command.openingCash,
          };
          response = { shift };
        } else if (op === "movements") {
          const amount = BigInt(command.amount.minorUnits);
          shift = {
            ...shift,
            cashIn: money(
              BigInt(shift.cashIn.minorUnits) +
                (command.type === "cash_in" ? amount : 0n),
            ),
            cashOut: money(
              BigInt(shift.cashOut.minorUnits) +
                (command.type === "cash_out" ? amount : 0n),
            ),
            expectedCash: money(
              BigInt(shift.expectedCash.minorUnits) +
                (command.type === "cash_in" ? amount : -amount),
            ),
          };
          const movement = {
            ...command,
            createdBy: user,
            createdAt: "2026-10-24T12:40:00.000Z",
          };
          movements.unshift(movement);
          response = { movement };
        } else if (op === "close") {
          shift = {
            ...shift,
            status: "closed",
            closedBy: user,
            closedByName: "Luis de prueba",
            closedAt: "2026-10-24T13:00:00.000Z",
            countedCash: command.countedCash,
            difference: money(
              BigInt(command.countedCash.minorUnits) -
                BigInt(shift.expectedCash.minorUnits),
            ),
          };
          response = { shift };
        } else throw new Error("UNEXPECTED_MUTATION");
        records.set(key, { command, response });
      }
      if (mode === "uncertain" && !uncertain) {
        uncertain = true;
        return {
          status: 500,
          body: { error: "Resultado incierto. Conserva la operación." },
        };
      }
      if (holdMutation) await holdMutation;
      return { status: 200, body: response };
    }
    throw new Error("UNEXPECTED_SYNTHETIC_REQUEST " + url);
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:55994/");
  await page.getByRole("heading", { name: "Caja", exact: true }).waitFor();
  if (mode === "no-access")
    await page
      .getByText("No tienes permiso para consultar caja.", { exact: true })
      .waitFor();
  else if (mode === "read-error")
    await page
      .getByRole("heading", { name: "Estado no disponible", exact: true })
      .waitFor();
  else
    await page
      .getByRole("heading", {
        name:
          mode === "none"
            ? "Prepara tu caja"
            : mode.startsWith("closed")
              ? "Resumen del último cierre"
              : "Resumen del turno abierto",
        exact: true,
      })
      .waitFor();
  return {
    context,
    page,
    calls,
    records,
    errors,
    hold() {
      holdMutation = new Promise((resolve) => {
        releaseMutation = resolve;
      });
    },
    release() {
      releaseMutation?.();
    },
    replaceShift() {
      shift = {
        ...baseShift(),
        id: "550e8400-e29b-41d4-a716-446655440031",
        openedByName: "Otro responsable",
      };
    },
    holdHistory() {
      holdHistory = new Promise((resolve) => {
        releaseHistory = resolve;
      });
    },
    releaseHistory() {
      releaseHistory?.();
    },
    close: () => context.close(),
  };
}
const posts = (s) => s.calls.filter((c) => c.method === "POST");
try {
  const open = await session(),
    p = open.page;
  await p.getByRole("cell", { name: "Retiro", exact: false }).first().waitFor();
  assert.ok(
    (await p.locator(".cash-summary").innerText()).includes("$160.00 MXN"),
  );
  await p.getByText("Ana de prueba", { exact: true }).first().waitFor();
  pass("open-shift-responsible-location-summary");
  await p
    .getByRole("button", { name: "Registrar ingreso", exact: true })
    .click();
  await p.getByRole("alert").waitFor();
  assert.equal(posts(open).length, 0);
  pass("zero-movement-invalid-without-post");
  await p
    .getByRole("textbox", { name: "Importe (MXN)", exact: true })
    .fill("25.50");
  await p
    .getByRole("textbox", { name: "Motivo", exact: true })
    .fill("Reposición de fondo");
  await p
    .getByRole("button", { name: "Registrar ingreso", exact: true })
    .click();
  await p.getByText("Operación confirmada.", { exact: true }).waitFor();
  await p.waitForFunction(() =>
    document
      .querySelector(".cash-summary")
      ?.textContent.includes("$185.50 MXN"),
  );
  assert.equal(posts(open)[0].url, "/api/v1/cash/movements");
  assert.equal(JSON.parse(posts(open)[0].body).amount.minorUnits, "2550");
  pass("income-original-command-and-server-summary");
  await p
    .getByRole("combobox", { name: "Tipo de movimiento", exact: true })
    .selectOption("cash_out");
  await p
    .getByRole("textbox", { name: "Importe (MXN)", exact: true })
    .fill("10.00");
  await p
    .getByRole("textbox", { name: "Motivo", exact: true })
    .fill("Retiro para depósito");
  await p
    .getByRole("button", { name: "Registrar retiro", exact: true })
    .click();
  await p.getByText("Operación confirmada.", { exact: true }).waitFor();
  await p.waitForFunction(() =>
    document
      .querySelector(".cash-summary")
      ?.textContent.includes("$175.50 MXN"),
  );
  pass("withdrawal-original-command");
  const before = posts(open).length;
  await p
    .getByRole("textbox", { name: "Efectivo contado (MXN)", exact: true })
    .fill("inválido");
  await p.getByRole("button", { name: "Revisar cierre", exact: true }).click();
  await p.getByRole("alert").waitFor();
  assert.equal(posts(open).length, before);
  pass("invalid-close-does-not-send");
  await p
    .getByRole("textbox", { name: "Efectivo contado (MXN)", exact: true })
    .fill("175.00");
  await p.getByRole("button", { name: "Revisar cierre", exact: true }).click();
  await p
    .getByRole("region", { name: "Confirmar cierre", exact: true })
    .waitFor();
  assert.equal(posts(open).length, before);
  pass("close-review-before-financial-request");
  await p.getByRole("button", { name: "Volver a editar", exact: true }).click();
  assert.equal(
    await p
      .getByRole("textbox", { name: "Efectivo contado (MXN)", exact: true })
      .inputValue(),
    "175.00",
  );
  assert.equal(posts(open).length, before);
  pass("cancel-close-preserves-count");
  await p.getByRole("button", { name: "Revisar cierre", exact: true }).click();
  await p.getByRole("button", { name: "Actualizar caja", exact: true }).click();
  await p
    .getByRole("button", { name: "Revisar cierre", exact: true })
    .waitFor();
  assert.equal(
    await p
      .getByRole("region", { name: "Confirmar cierre", exact: true })
      .count(),
    0,
  );
  assert.equal(posts(open).length, before);
  pass("refresh-invalidates-previous-close-review");
  await p.getByRole("button", { name: "Revisar cierre", exact: true }).click();
  await p
    .getByRole("button", { name: "Confirmar cierre", exact: true })
    .click();
  await p
    .getByRole("heading", { name: "Resumen del último cierre", exact: true })
    .waitFor();
  assert.ok(
    (await p.locator(".cash-difference").innerText()).includes("-$0.50 MXN"),
  );
  assert.ok(
    (await p.locator(".cash-difference").innerText()).includes("Faltante"),
  );
  pass("confirmed-close-server-difference");
  assert.equal(posts(open).length, before + 1);
  pass("single-close-request-after-confirmation");
  await p.getByText("Reposición de fondo", { exact: true }).waitFor();
  await p.getByText("Luis de prueba", { exact: true }).first().waitFor();
  pass("read-only-history-and-closed-metadata");
  assert.deepEqual(open.errors, []);
  await open.close();
  const opening = await session("none");
  await opening.page
    .getByRole("textbox", { name: "Fondo inicial (MXN)", exact: true })
    .fill("150.25");
  opening.hold();
  await opening.page
    .getByRole("button", { name: "Abrir caja", exact: true })
    .evaluate((b) => {
      b.click();
      b.click();
    });
  await opening.page
    .getByText("Procesando…", { exact: true })
    .first()
    .waitFor();
  assert.equal(posts(opening).length, 1);
  opening.release();
  await opening.page
    .getByRole("heading", { name: "Resumen del turno abierto", exact: true })
    .waitFor();
  assert.equal(
    JSON.parse(posts(opening)[0].body).openingCash.minorUnits,
    "15025",
  );
  pass("opening-single-submit-exact-amount");
  await opening.close();
  const pending = await session("uncertain");
  await pending.page
    .getByRole("textbox", { name: "Importe (MXN)", exact: true })
    .fill("5.00");
  await pending.page
    .getByRole("textbox", { name: "Motivo", exact: true })
    .fill("Ingreso de prueba");
  await pending.page
    .getByRole("button", { name: "Registrar ingreso", exact: true })
    .click();
  await pending.page
    .getByRole("button", { name: "Reintentar operación", exact: true })
    .waitFor();
  assert.equal(
    await pending.page
      .getByRole("textbox", { name: "Importe (MXN)", exact: true })
      .isDisabled(),
    true,
  );
  await pending.page.reload();
  await pending.page
    .getByRole("button", { name: "Reintentar operación", exact: true })
    .click();
  await pending.page
    .getByText("Operación confirmada.", { exact: true })
    .waitFor();
  assert.equal(pending.records.size, 1);
  assert.deepEqual(
    JSON.parse(posts(pending)[0].body),
    JSON.parse(posts(pending)[1].body),
  );
  pass("uncertain-movement-reload-same-id-and-data");
  await pending.close();
  for (const mode of ["closed-zero", "closed-surplus", "closed-large"]) {
    const s = await session(mode, 390, 844);
    const text = await s.page.locator(".cash-difference").innerText();
    assert.ok(
      text.includes(
        mode === "closed-zero"
          ? "Sin diferencia"
          : mode === "closed-surplus"
            ? "Sobrante"
            : "-$90071992547409.93 MXN",
      ),
    );
    assert.ok(
      await s.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    pass("difference-display-" + mode);
    await s.close();
  }
  for (const [width, height, label] of [
    [1440, 1000, "desktop"],
    [1024, 768, "tablet"],
    [768, 900, "small-tablet"],
    [390, 844, "mobile"],
    [320, 740, "small-mobile"],
  ]) {
    const s = await session("open", width, height),
      p = s.page;
    await p
      .getByRole("cell", { name: "Retiro", exact: false })
      .first()
      .waitFor();
    assert.ok(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    const buttons = await p.locator(".cash-actions button").all();
    for (const b of buttons) {
      const bounds = await b.boundingBox();
      assert.ok(bounds.height >= 44 && bounds.width >= 100);
    }
    if (process.argv[2]) {
      await p.screenshot({
        path: path.join(process.argv[2], `cash-${label}.png`),
        fullPage: false,
      });
      if (width === 390) {
        await p
          .getByRole("heading", {
            name: "Historial reciente de esta ubicación",
          })
          .scrollIntoViewIfNeeded();
        await p.screenshot({
          path: path.join(process.argv[2], "cash-history-mobile.png"),
          fullPage: false,
        });
      }
    }
    assert.deepEqual(s.errors, []);
    pass("responsive-controls-" + width);
    await s.close();
  }
  const retry = await session("read-error");
  assert.equal(
    await retry.page
      .getByRole("button", { name: "Abrir caja", exact: true })
      .count(),
    0,
  );
  await retry.page
    .getByRole("button", { name: "Reintentar consulta", exact: true })
    .click();
  await retry.page
    .getByRole("heading", { name: "Resumen del turno abierto", exact: true })
    .waitFor();
  assert.equal(posts(retry).length, 0);
  pass("read-error-is-not-a-closed-shift");
  await retry.close();
  const hist = await session("history-error");
  await hist.page
    .getByText("No pudimos cargar el historial.", { exact: false })
    .waitFor();
  assert.equal(
    await hist.page
      .getByRole("button", { name: "Registrar ingreso", exact: true })
      .isEnabled(),
    true,
  );
  assert.equal(posts(hist).length, 0);
  pass("history-error-independent-of-valid-cash-state");
  await hist.close();
  const changed = await session();
  await changed.page
    .getByRole("cell", { name: "Retiro", exact: false })
    .first()
    .waitFor();
  changed.holdHistory();
  await changed.page
    .getByRole("button", { name: "Actualizar historial", exact: true })
    .click();
  await changed.page
    .getByRole("combobox", { name: "Ubicación", exact: true })
    .selectOption(otherLocation);
  await changed.page
    .getByRole("heading", { name: "Prepara tu caja", exact: true })
    .waitFor();
  changed.releaseHistory();
  await changed.page
    .getByText("No hay movimientos registrados en esta ubicación.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await changed.page
      .getByText(
        "Retiro de efectivo para depósito con concepto detallado de prueba",
        { exact: true },
      )
      .count(),
    0,
  );
  pass("location-switch-rejects-late-history");
  await changed.close();
  const switched = await session();
  await switched.page
    .getByRole("textbox", { name: "Efectivo contado (MXN)", exact: true })
    .fill("160.00");
  await switched.page
    .getByRole("button", { name: "Revisar cierre", exact: true })
    .click();
  switched.replaceShift();
  await switched.page
    .getByRole("button", { name: "Actualizar caja", exact: true })
    .click();
  await switched.page
    .getByText("Otro responsable", { exact: true })
    .first()
    .waitFor();
  assert.equal(
    await switched.page
      .getByRole("button", { name: "Confirmar cierre", exact: true })
      .count(),
    0,
  );
  assert.equal(posts(switched).length, 0);
  pass("different-shift-requires-a-new-close-review");
  await switched.page
    .getByRole("combobox", { name: "Ubicación", exact: true })
    .selectOption("");
  await switched.page
    .getByText("Selecciona una ubicación activa para consultar su caja.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await switched.page.getByText("Cargando caja…", { exact: true }).count(),
    0,
  );
  assert.equal(posts(switched).length, 0);
  pass("empty-location-does-not-stay-loading");
  await switched.close();
  const denied = await session("no-access");
  assert.equal(
    denied.calls.filter((c) => c.url.startsWith("/api/v1/cash")).length,
    0,
  );
  pass("no-membership-no-cash-queries");
  await denied.close();
  assert.equal(externalRequests, 0);
  pass("zero-external-service-requests");
  console.log(JSON.stringify({ checks, externalRequests }));
} finally {
  await browser.close();
}
