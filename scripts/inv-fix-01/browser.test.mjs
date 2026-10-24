// Component tests only: real React/Chromium, synthetic HTTP binding, zero service calls.
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
  fixture = path.join(root, "scripts/inv-fix-01");
const result = await build({
  configFile: false,
  envDir: false,
  root,
  logLevel: "silent",
  resolve: {
    alias: [
      ...[
        "next/navigation",
        "next/link",
        "../../lib/supabase/client",
        "../components/app-navigation",
        "../components/ui",
      ].map((find) => ({ find, replacement: path.join(fixture, "shims.tsx") })),
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
    lib: {
      entry: path.join(fixture, "fixture.tsx"),
      name: "InventoryFixture",
      formats: ["iife"],
    },
  },
});
const chunk = (Array.isArray(result) ? result[0] : result).output.find(
  (x) => x.type === "chunk",
);
assert.ok(chunk);
assert.ok(
  !Object.keys(chunk.modules).some((n) =>
    /@supabase\/|\/next\/dist\//.test(n.replaceAll("\\", "/")),
  ),
);
const tenant = "550e8400-e29b-41d4-a716-446655440001",
  location = "550e8400-e29b-41d4-a716-446655440011",
  product = "550e8400-e29b-41d4-a716-446655440010";
const browser = await chromium.launch({ headless: true });
let externalRequests = 0;
const baseline = process.argv.includes("--baseline");
const html = `<meta charset="utf-8"><div id="root"></div><script>${chunk.code.replaceAll("</script", "<\\/script")}</script>`;
async function scenario(mode) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", (r) => {
    if (r.request().url() === "http://127.0.0.1:55991/")
      return r.fulfill({ contentType: "text/html", body: html });
    externalRequests++;
    return r.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const posts = [],
    committed = new Set();
  let lose = true;
  let release = () => {};
  const pendingKey =
    "smartretail.pending-inventory.550e8400-e29b-41d4-a716-446655440020";
  await page.exposeFunction("inventoryMock", async (url, init) => {
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      posts.push({ url, body, headers: init.headers });
      committed.add(body.id);
      if (lose) {
        lose = false;
        if (mode === "delayed" || mode === "late-same-page")
          await new Promise((resolve) => {
            release = resolve;
          });
        else if (!["storage-write", "storage-clear"].includes(mode))
          throw Error("SYNTHETIC_RESPONSE_LOST_AFTER_COMMIT");
      } else if (mode.startsWith("reject-"))
        return {
          status: Number(mode.slice(7)),
          body: { error: "Rechazo ficticio" },
        };
      else if (mode === "ack-empty") return { status: 200, body: {} };
      else if (mode === "ack-unit")
        return {
          status: 200,
          body: {
            balance: {
              productId: product,
              locationId: location,
              quantity: { unit: "kg", milliUnits: "2000" },
            },
          },
        };
      return {
        status: 200,
        body: {
          balance: {
            productId: product,
            locationId: location,
            quantity: { unit: "piece", milliUnits: "2000" },
          },
        },
      };
    }
    if (url === "/api/v1/tenants")
      return {
        status: 200,
        body: {
          tenants: [
            {
              tenantId: tenant,
              tenantName: "Ficticia",
              permissions: [
                "inventory.read",
                "inventory.receive",
                "locations.write",
              ],
            },
          ],
        },
      };
    if (url === "/api/v1/locations")
      return {
        status: 200,
        body: {
          locations: [
            {
              id: location,
              name: "Local ficticio",
              code: "TEST",
              status: "active",
            },
          ],
        },
      };
    if (url === "/api/v1/inventory")
      return {
        status: 200,
        body: {
          stock: [
            {
              productId: product,
              productName: "Producto ficticio",
              sku: "TEST",
              locationId: location,
              quantity: { unit: "piece", milliUnits: "1000" },
              minimumStock: null,
              inventoryState: "normal",
            },
          ],
        },
      };
    throw Error("UNEXPECTED_SYNTHETIC_ROUTE");
  });
  async function newReceipt() {
    await page
      .getByRole("button", { name: "Recibir Producto ficticio", exact: true })
      .click();
    await page.getByRole("textbox", { name: /^Cantidad/ }).fill("1");
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  }
  try {
    await page.goto("http://127.0.0.1:55991/");
    if (mode === "corrupt") {
      await page.evaluate(
        (k) => sessionStorage.setItem(k, "invalid-record"),
        pendingKey,
      );
      await page.reload();
      await page
        .getByText("No podemos recuperar la operación pendiente", {
          exact: false,
        })
        .waitFor();
      assert.equal(posts.length, 0);
      assert.equal(
        await page.evaluate((k) => sessionStorage.getItem(k), pendingKey),
        "invalid-record",
      );
      assert.ok(
        await page
          .getByRole("button", { name: "Nueva ubicación", exact: true })
          .isDisabled(),
      );
      return;
    }
    if (mode.startsWith("storage-")) {
      await page
        .getByRole("button", { name: "Recibir Producto ficticio", exact: true })
        .waitFor();
      await page.evaluate((m) => {
        Storage.prototype[m === "storage-write" ? "setItem" : "removeItem"] =
          () => {
            throw Error("SYNTHETIC_STORAGE_UNAVAILABLE");
          };
      }, mode);
    }
    if (mode === "delayed" || mode === "late-same-page") {
      await page
        .getByRole("button", { name: "Recibir Producto ficticio", exact: true })
        .click();
      await page.getByRole("textbox", { name: /^Cantidad/ }).fill("1");
      await page
        .getByRole("button", { name: "Confirmar", exact: true })
        .evaluate((b) => {
          b.form.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          );
          b.form.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          );
        });
      await page
        .getByRole("button", { name: "Confirmando…", exact: true })
        .waitFor();
    } else {
      await newReceipt();
    }
    if (mode === "storage-write") {
      await page
        .getByText("No se envió la operación", { exact: false })
        .waitFor();
      assert.equal(posts.length, 0);
      assert.equal(committed.size, 0);
      return;
    }
    if (mode === "storage-clear") {
      await page
        .getByText("Operación confirmada, pero", { exact: false })
        .waitFor();
    } else if (mode !== "delayed" && mode !== "late-same-page") {
      await page
        .getByText("No pudimos confirmar el resultado.", { exact: false })
        .waitFor();
    }
    const stored = await page.evaluate(
      (k) => sessionStorage.getItem(k),
      pendingKey,
    );
    if (mode === "late-same-page") {
      assert.equal(posts.length, 1);
      release();
      await page.getByText("Operación confirmada.", { exact: true }).waitFor();
      assert.equal(posts.length, 1);
      assert.equal(committed.size, 1);
      assert.equal(
        await page.evaluate((k) => sessionStorage.getItem(k), pendingKey),
        null,
      );
      return;
    }
    await page.reload();
    if (baseline) {
      await newReceipt();
      await page.getByText("Operación confirmada.", { exact: true }).waitFor();
      assert.equal(posts.length, 2);
      assert.notEqual(posts[0].body.id, posts[1].body.id);
      assert.equal(committed.size, 2);
      console.log(
        JSON.stringify({
          riskReproduced: true,
          posts: 2,
          distinctCommittedIds: 2,
          externalRequests,
        }),
      );
    } else {
      await page
        .getByRole("button", {
          name: "Reintentar operación pendiente",
          exact: true,
        })
        .waitFor();
      assert.equal(posts.length, 1, "Recovery must not send automatically");
      if (mode === "other-user") {
        await page.evaluate(() =>
          window.mountInventory("550e8400-e29b-41d4-a716-446655440021"),
        );
        await page
          .getByRole("button", {
            name: "Recibir Producto ficticio",
            exact: true,
          })
          .waitFor();
        assert.equal(
          await page.evaluate((k) => sessionStorage.getItem(k), pendingKey),
          stored,
        );
        assert.equal(posts.length, 1);
        return;
      }
      await page
        .getByRole("button", {
          name: "Reintentar operación pendiente",
          exact: true,
        })
        .click();
      if (mode.startsWith("reject-") || mode.startsWith("ack-")) {
        await page
          .getByText("No pudimos confirmar el resultado.", { exact: false })
          .waitFor();
        assert.equal(
          await page.evaluate((k) => sessionStorage.getItem(k), pendingKey),
          stored,
        );
        assert.equal(posts.length, 2);
        assert.deepEqual(posts[0], posts[1]);
        assert.equal(committed.size, 1);
        return;
      }
      await page.getByText("Operación confirmada.", { exact: true }).waitFor();
      assert.equal(posts.length, 2);
      assert.deepEqual(posts[0], posts[1]);
      assert.equal(committed.size, 1);
      assert.equal(
        await page.evaluate((k) => sessionStorage.getItem(k), pendingKey),
        null,
      );
      if (mode === "delayed") {
        release();
      }
    }
    assert.equal(externalRequests, 0);
  } catch (error) {
    console.log(
      JSON.stringify({
        syntheticDiagnostic: await page.locator("body").innerText(),
        posts: posts.length,
        committed: committed.size,
      }),
    );
    throw error;
  } finally {
    release();
    await context.close();
  }
}
try {
  const modes = baseline
    ? ["baseline"]
    : [
        "lost",
        "delayed",
        "late-same-page",
        "ack-empty",
        "ack-unit",
        "storage-write",
        "storage-clear",
        "corrupt",
        "other-user",
        "reject-400",
        "reject-401",
        "reject-403",
        "reject-404",
        "reject-409",
        "reject-500",
      ];
  for (const mode of modes) {
    await scenario(mode);
    console.log(JSON.stringify({ mode, result: "PASS", externalRequests }));
  }
} finally {
  await browser.close();
}
