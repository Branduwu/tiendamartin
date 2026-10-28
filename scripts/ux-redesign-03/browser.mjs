// Team and business settings UI only. All service calls are synthetic and all external HTTP blocked.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
const require = createRequire(import.meta.url),
  root = process.cwd(),
  fixture = path.join(root, "scripts/ux-redesign-03");
const phase = process.argv[2] ?? "after",
  out = process.env.SETTINGS_UX_EVIDENCE_DIR,
  baseline = process.env.SETTINGS_UX_BASELINE_ROOT;
assert.ok(out, "Set SETTINGS_UX_EVIDENCE_DIR outside the repository");
fs.mkdirSync(out, { recursive: true });
if (phase === "before") {
  assert.ok(baseline);
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: baseline,
      encoding: "utf8",
    }).trim(),
    "039049020f0c9e85db54088c537be633dae2106e",
  );
  assert.equal(
    execFileSync("git", ["status", "--porcelain=v1"], {
      cwd: baseline,
      encoding: "utf8",
    }).trim(),
    "",
  );
}
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
const result = await build({
  configFile: false,
  envDir: false,
  root,
  logLevel: "silent",
  plugins: [
    {
      name: "account-fixture",
      enforce: "pre",
      resolveId(id, importer) {
        if (
          id.endsWith("/lib/auth") &&
          importer?.endsWith("/settings/account/page.tsx")
        )
          return "virtual:verified";
        if (
          phase === "before" &&
          importer?.endsWith("/fixture.tsx") &&
          id.startsWith("../../apps/")
        ) {
          const p = path.join(baseline, id.slice(6));
          return (fs.existsSync(p) ? p : p + ".tsx").replaceAll("\\", "/");
        }
      },
      load(id) {
        if (id === "virtual:verified")
          return 'export async function verifiedUserId(){return "550e8400-e29b-41d4-a716-446655440001";}';
      },
    },
  ],
  resolve: {
    alias: [
      {
        find: "next/link",
        replacement: path.join(root, "scripts/ux-redesign-02/shims.tsx"),
      },
      {
        find: "next/navigation",
        replacement: path.join(root, "scripts/ux-redesign-02/shims.tsx"),
      },
      {
        find: "../../lib/supabase/client",
        replacement: path.join(root, "scripts/ux-redesign-02/shims.tsx"),
      },
      {
        find: "@smartretail/contracts",
        replacement: path.join(root, "packages/contracts/src/index.ts"),
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
    cssCodeSplit: false,
    lib: {
      entry: path.join(fixture, "fixture.tsx"),
      name: "AccountFixture",
      formats: ["iife"],
    },
  },
});
const output = (Array.isArray(result) ? result[0] : result).output,
  chunk = output.find((x) => x.type === "chunk"),
  css = output
    .filter((x) => x.type === "asset" && x.fileName.endsWith(".css"))
    .map((x) => x.source)
    .join("\n");
assert.ok(
  !Object.keys(chunk.modules).some((x) =>
    /@supabase\/|\/next\/dist\//.test(x.replaceAll("\\", "/")),
  ),
);
const html = `<!doctype html><html lang="es" data-theme="light"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SmartRetail · Cuenta de prueba</title><style>${css}</style><body class="retail-ui"><div id="root"></div><script>${chunk.code.replaceAll("</script", "<\\/script")}</script></body></html>`;
const uid = (n) => `550e8400-e29b-41d4-a716-${String(n).padStart(12, "0")}`,
  tenant = uid(1),
  actor = uid(2);
const baseProfile = {
  businessName: "Tienda de prueba",
  tradeName: "Comercio de prueba",
  phone: "555-0100",
  email: "negocio@example.invalid",
  website: null,
  ticketFooter: "Gracias por tu visita",
  logoUrl: null,
  timezone: "America/Mexico_City",
  locale: "es-MX",
  currency: "MXN",
};
const baseBranches = Array.from({ length: 11 }, (_, i) => ({
  id: uid(i + 11),
  name: `Sucursal ${String(i + 1).padStart(2, "0")}`,
  code: `S${String(i + 1).padStart(2, "0")}`,
  displayName: null,
  address: null,
  phone: null,
  receiptHeader: null,
  status: i < 9 ? "active" : "inactive",
}));
const baseMembers = Array.from({ length: 11 }, (_, i) => ({
  userId: uid(i + 2),
  displayName:
    i === 0 ? "Persona propietaria" : `Empleado ${String(i).padStart(2, "0")}`,
  role: i === 0 ? "owner" : "cashier",
  status: i < 8 ? "active" : "inactive",
  allLocations: i === 0,
  locationIds: i === 0 ? [] : [uid(11)],
}));
const browser = await chromium.launch({ headless: true });
const checks = [],
  captures = [];
let external = 0;
const pass = (name) => checks.push(name);
async function session(view = "/settings/users", width = 1366, mode = "ok") {
  const context = await browser.newContext({
      viewport: { width, height: 900 },
      locale: "es-MX",
      colorScheme: "light",
    }),
    page = await context.newPage();
  let profile = structuredClone(baseProfile),
    branches = mode === "empty" ? [] : structuredClone(baseBranches),
    members = mode === "empty" ? [] : structuredClone(baseMembers),
    invitations = [],
    requestFail = mode === "error",
    release,
    held = mode === "loading",
    createdByNonce = new Map();
  const calls = [],
    errors = [];
  const permissions =
    mode === "denied"
      ? []
      : [
          "members.manage",
          "settings.manage",
          "locations.read",
          "locations.write",
          "reports.read",
        ];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (r) => {
    if (
      r.request().isNavigationRequest() &&
      r.request().url().startsWith("http://127.0.0.1:55994/")
    )
      return r.fulfill({ contentType: "text/html", body: html });
    external++;
    return r.abort();
  });
  await page.exposeFunction("settingsMock", async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init.method, headers: init.headers, body });
    const ok = (v) => ({ status: 200, body: v });
    if (url === "/api/v1/tenants")
      return ok({
        tenants: [
          {
            tenantId: tenant,
            tenantName: "Tienda de prueba",
            tenantStatus: "active",
            userId: actor,
            role: "owner",
            permissions,
          },
        ],
      });
    if (url === "/api/v1/platform")
      return { status: 403, body: { error: "No autorizado" } };
    if (url === "/api/v1/profile?summary=1")
      return ok({ displayName: "Persona propietaria", photoEnabled: false });
    if (
      url === "/api/v1/members" ||
      url === "/api/v1/invitations" ||
      url === "/api/v1/business"
    ) {
      if (init.method === "GET" && held)
        await new Promise((r) => {
          const previous = release;
          release = () => {
            previous?.();
            r();
          };
        });
      if (init.method === "GET" && requestFail)
        return { status: 503, body: { error: "Consulta no disponible" } };
    }
    if (url === "/api/v1/members") return ok({ members, locations: branches });
    if (url.startsWith("/api/v1/members/") && init.method === "PATCH") {
      if (mode === "save-error")
        return {
          status: 400,
          body: { error: "No se pudo guardar el acceso." },
        };
      const id = url.split("/").at(-1);
      const m = members.find((m) => m.userId === id);
      assert.notEqual(m.role, "owner");
      Object.assign(m, body, { allLocations: body.role === "admin" });
      return ok({ member: m });
    }
    if (url === "/api/v1/invitations" && init.method === "GET")
      return ok({ invitations, locations: branches });
    if (url === "/api/v1/invitations" && init.method === "POST") {
      if (mode === "save-error")
        return {
          status: 400,
          body: { error: "No se pudo crear la invitación." },
        };
      let inv = createdByNonce.get(body.creationNonce);
      if (inv)
        return {
          status: 409,
          body: {
            error:
              "Esta solicitud de invitaci\u00f3n ya se registr\u00f3. Consulta las invitaciones.",
          },
        };
      if (!inv) {
        inv = {
          id: uid(80 + invitations.length),
          email: body.email,
          role: body.role,
          locationIds: body.locationIds,
          expiresAt: "2099-01-01T00:00:00Z",
          acceptedAt: null,
          revokedAt: null,
        };
        invitations = [inv, ...invitations];
        createdByNonce.set(body.creationNonce, inv);
      }
      if (mode === "lost") throw Error("Synthetic lost response");
      return {
        status: 201,
        body: {
          invitation: inv,
          token: "a".repeat(64),
          emailDelivery: { status: "accepted" },
        },
      };
    }
    if (url === "/api/v1/business" && init.method === "GET")
      return ok({ profile, branches });
    if (url === "/api/v1/business" && init.method === "PUT") {
      if (held)
        await new Promise((r) => {
          release = r;
        });
      if (mode === "save-error")
        return {
          status: 400,
          body: { error: "No se pudo guardar el negocio." },
        };
      assert.deepEqual(
        Object.keys(body).sort(),
        Object.keys(baseProfile).sort(),
      );
      profile = { ...body };
      return ok({ saved: true });
    }
    if (
      url.startsWith("/api/v1/business/branches/") &&
      init.method === "PATCH"
    ) {
      if (mode === "save-error")
        return {
          status: 400,
          body: { error: "No se pudo guardar la sucursal." },
        };
      assert.deepEqual(Object.keys(body).sort(), [
        "address",
        "displayName",
        "phone",
        "receiptHeader",
        "status",
      ]);
      Object.assign(
        branches.find((b) => b.id === url.split("/").at(-1)),
        body,
      );
      return ok({ saved: true });
    }
    return { status: 404, body: { error: "Unmocked request" } };
  });
  await page.goto("http://127.0.0.1:55994" + view);
  await page.getByRole("heading", { level: 1 }).waitFor();
  if (!["loading", "denied", "error"].includes(mode)) {
    if (view.endsWith("users")) {
      if (mode === "empty")
        await page
          .getByText("No hay usuarios disponibles.", { exact: true })
          .waitFor();
      else await page.locator("table tbody tr").first().waitFor();
    } else await page.locator("input[name=businessName]").waitFor();
  }
  return {
    page,
    context,
    calls,
    errors,
    recover() {
      requestFail = false;
      held = false;
      release?.();
    },
    hold() {
      held = true;
    },
    members: () => members,
    branches: () => branches,
    invitations: () => invitations,
  };
}
const mutations = (s) =>
  s.calls.filter((c) => !["GET", "HEAD"].includes(c.method));
async function branchesView(p) {
  if (phase === "after")
    await p.getByRole("tab", { name: "Sucursales", exact: true }).click();
}
try {
  for (const width of [1366, 768, 390, 360])
    for (const view of ["/settings/users", "/settings/business"]) {
      const s = await session(view, width),
        p = s.page;
      const type = view.endsWith("users") ? "equipo" : "sucursales";
      await branchesViewIfNeeded();
      async function branchesViewIfNeeded() {
        if (type === "sucursales") await branchesView(p);
      }
      await p.screenshot({
        path: path.join(out, `${phase}-${type}-${width}.png`),
        fullPage: true,
      });
      captures.push(`${type}-${width}`);
      if (phase === "after") {
        assert.equal(
          await p.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        if (type === "equipo") {
          assert.equal(await p.locator("input[type=email]").count(), 0);
          assert.equal(
            await p.getByRole("button", { name: /Editar acceso de/ }).count(),
            11,
          );
          assert.ok(
            await p
              .getByRole("button", {
                name: "Editar acceso de Persona propietaria",
                exact: true,
              })
              .isDisabled(),
          );
        } else {
          assert.equal(
            await p.locator('form[aria-label^="Configurar"]').count(),
            0,
          );
          assert.equal(
            await p.getByRole("button", { name: /Editar sucursal/ }).count(),
            11,
          );
        }
        const axe = await new AxeBuilder({ page: p })
          .include("#workspace-content")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        assert.deepEqual(
          axe.violations.map((v) => v.id),
          [],
        );
        pass(`list-first-responsive-axe-${type}-${width}`);
      }
      assert.deepEqual(s.errors, []);
      await s.context.close();
    }
  if (phase === "after") {
    for (const width of [1366, 768, 390, 360]) {
      const s = await session("/settings/users", width),
        p = s.page;
      const trigger = p.getByRole("button", {
        name: "Invitar empleado",
        exact: true,
      });
      await trigger.click();
      await p.locator("input[type=email]").fill("invitation@example.invalid");
      await p
        .locator("summary")
        .filter({ hasText: "Elegir sucursales" })
        .click();
      const search = p.getByRole("searchbox");
      assert.equal(await p.getByRole("checkbox").count(), 9);
      assert.equal(
        await p.locator("select[aria-label] option[value=owner]").count(),
        0,
      );
      if (width === 1366 || width === 390) {
        await p.evaluate(() => window.scrollTo(0, 0));
        await p.screenshot({
          path: path.join(out, `after-invitar-${width}.png`),
          fullPage: true,
        });
        const axe = await new AxeBuilder({ page: p })
          .include("#workspace-content")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        assert.deepEqual(
          axe.violations.map((v) => v.id),
          [],
        );
      }
      await search.fill("09");
      await p
        .getByRole("checkbox", { name: "Sucursal 09", exact: true })
        .check();
      await search.fill("01");
      await p
        .getByRole("checkbox", { name: "Sucursal 01", exact: true })
        .check();
      await search.fill("09");
      assert.ok(
        await p
          .getByRole("checkbox", { name: "Sucursal 09", exact: true })
          .isChecked(),
      );
      await p.getByRole("button", { name: /Cancelar invitaci/ }).click();
      await p.waitForFunction(
        () => document.activeElement?.textContent === "Invitar empleado",
      );
      assert.equal(mutations(s).length, 0);
      await trigger.press("Enter");
      await p.locator("input[type=email]").fill("invitation@example.invalid");
      await p
        .locator("summary")
        .filter({ hasText: "Elegir sucursales" })
        .click();
      await p
        .getByRole("checkbox", { name: "Sucursal 01", exact: true })
        .check();
      await p.getByRole("button", { name: /Crear invitaci/ }).click();
      await p.getByText(/correo aceptado por el proveedor/).waitFor();
      assert.equal(mutations(s).length, 1);
      assert.equal(mutations(s)[0].body.role, "cashier");
      assert.deepEqual(mutations(s)[0].body.locationIds, [uid(11)]);
      assert.ok(
        await p
          .getByRole("button", { name: /Copiar enlace de invitaci/ })
          .isVisible(),
      );
      await p.getByRole("tab", { name: "Miembros", exact: true }).click();
      const edit = p.getByRole("button", {
        name: "Editar acceso de Empleado 01",
        exact: true,
      });
      await edit.click();
      await p.getByLabel("Nombre operativo").fill("Empleado actualizado");
      assert.ok(
        await p
          .getByRole("button", { name: "Invitar empleado", exact: true })
          .isDisabled(),
      );
      await p.getByRole("button", { name: "Cancelar", exact: true }).click();
      await p.waitForFunction(
        () =>
          document.activeElement?.getAttribute("aria-label") ===
          "Editar acceso de Empleado 01",
      );
      assert.equal(mutations(s).length, 1);
      pass(`invite-search-cancel-send-member-focus-${width}`);
      await s.context.close();
      const b = await session("/settings/business", width),
        q = b.page;
      await branchesView(q);
      await q.getByRole("searchbox").fill("03");
      assert.equal(
        await q.getByRole("button", { name: /Editar sucursal/ }).count(),
        1,
      );
      const editBranch = q.getByRole("button", {
        name: "Editar sucursal Sucursal 03",
        exact: true,
      });
      await editBranch.click();
      if (width === 1366 || width === 390) {
        await q.evaluate(() => window.scrollTo(0, 0));
        await q.screenshot({
          path: path.join(out, `after-editar-sucursal-${width}.png`),
          fullPage: true,
        });
        const axe = await new AxeBuilder({ page: q })
          .include("#workspace-content")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        assert.deepEqual(
          axe.violations.map((v) => v.id),
          [],
        );
      }
      assert.equal(
        await q.locator('form[aria-label^="Configurar"]').count(),
        1,
      );
      await q.getByRole("button", { name: "Cancelar", exact: true }).click();
      await q.waitForFunction(
        () =>
          document.activeElement?.getAttribute("aria-label") ===
          "Editar sucursal Sucursal 03",
      );
      assert.equal(mutations(b).length, 0);
      await editBranch.click();
      await q.locator("input[name=displayName]").fill("Sucursal editada");
      await q.getByRole("button", { name: /Guardar sucursal/ }).click();
      await q
        .locator('form[aria-label^="Configurar"]')
        .waitFor({ state: "detached" });
      await q.waitForFunction(
        () => document.activeElement?.getAttribute("type") === "search",
      );
      assert.equal(mutations(b).length, 1);
      await q.getByRole("searchbox").fill("editada");
      assert.equal(
        await q.getByRole("button", { name: /Editar sucursal/ }).count(),
        1,
      );
      await q.getByRole("tab", { name: "General", exact: true }).click();
      await q.locator("input[name=businessName]").fill("Nuevo nombre");
      await q
        .getByRole("button", { name: "Guardar datos generales", exact: true })
        .click();
      await q
        .getByRole("button", { name: "Guardar datos generales", exact: true })
        .waitFor();
      await q.getByRole("tab", { name: "Ticket", exact: true }).click();
      await q.locator("input[name=ticketFooter]").fill("Nuevo pie");
      await q
        .getByRole("button", { name: "Guardar ticket", exact: true })
        .click();
      await q.waitForFunction(() => !document.querySelector("button:disabled"));
      assert.equal(mutations(b).at(-1).body.businessName, "Nuevo nombre");
      assert.equal(mutations(b).at(-1).body.ticketFooter, "Nuevo pie");
      assert.equal(
        await q.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      pass(`branch-search-single-cancel-save-full-profile-contract-${width}`);
      await b.context.close();
    }
    for (const view of ["/settings/users", "/settings/business"]) {
      for (const mode of ["empty", "error", "loading", "denied"]) {
        const s = await session(view, 390, mode),
          p = s.page;
        if (mode === "empty") {
          if (view.endsWith("business")) await branchesView(p);
          assert.equal(
            await p
              .getByRole("button", { name: /Editar sucursal|Editar acceso de/ })
              .count(),
            0,
          );
        } else if (mode === "error") {
          await p
            .getByRole("alert")
            .filter({ hasText: "Consulta no disponible" })
            .first()
            .waitFor();
          s.recover();
          await p
            .getByRole("button", { name: /^Reintentar/ })
            .first()
            .click();
          if (view.endsWith("users"))
            await p.locator("table tbody tr").first().waitFor();
          else await p.locator("input[name=businessName]").waitFor();
        } else if (mode === "loading") {
          await p
            .getByRole("status")
            .filter({ hasText: /Cargando/ })
            .first()
            .waitFor();
          assert.equal(mutations(s).length, 0);
          s.recover();
          if (view.endsWith("users"))
            await p.locator("table tbody tr").first().waitFor();
          else await p.locator("input[name=businessName]").waitFor();
        } else {
          await p
            .getByText(/No tienes permiso/)
            .first()
            .waitFor();
          assert.equal(
            await p
              .getByRole("button", { name: /Invitar empleado|Guardar/ })
              .count(),
            0,
          );
        }
        assert.equal(mutations(s).length, 0);
        pass(`${view}-${mode}`);
        await s.context.close();
      }
    }
    {
      const s = await session("/settings/business", 768, "save-error"),
        p = s.page;
      await branchesView(p);
      await p
        .getByRole("button", {
          name: "Editar sucursal Sucursal 11",
          exact: true,
        })
        .click();
      await p.getByText(/Inactiva conserva su historial/).waitFor();
      await p.getByRole("button", { name: /Guardar sucursal/ }).click();
      await p
        .getByRole("alert")
        .filter({ hasText: "No se pudo guardar la sucursal." })
        .waitFor();
      assert.equal(
        await p.locator('form[aria-label^="Configurar"]').count(),
        1,
      );
      assert.equal(s.branches().at(-1).status, "inactive");
      assert.equal(
        await p
          .getByText("Configuraci\u00f3n guardada.", { exact: true })
          .count(),
        0,
      );
      await p.getByRole("button", { name: "Cancelar", exact: true }).click();
      pass("branch-error-no-false-success-warning-preserved");
      await s.context.close();
    }
    {
      const s = await session("/settings/users"),
        p = s.page;
      const tab = p.getByRole("tab", { name: "Miembros", exact: true });
      await tab.focus();
      await tab.press("ArrowRight");
      await p.waitForFunction(
        () => document.activeElement?.textContent === "Invitaciones",
      );
      assert.equal(
        await p
          .getByRole("tab", { name: "Invitaciones", exact: true })
          .getAttribute("aria-selected"),
        "true",
      );
      await p.keyboard.press("Home");
      await p.waitForFunction(
        () => document.activeElement?.textContent === "Miembros",
      );
      pass("keyboard-tabs-roving-focus");
      await s.context.close();
    }
    {
      const s = await session("/settings/business"),
        p = s.page;
      assert.ok((await p.locator(".app-sidebar nav a").count()) > 0);
      s.hold();
      await p
        .getByRole("button", { name: "Guardar datos generales", exact: true })
        .click();
      await p.getByText(/Termina la operaci/).waitFor();
      assert.ok(
        await p.getByRole("tab", { name: "Ticket", exact: true }).isDisabled(),
      );
      assert.equal(await p.locator(".app-sidebar nav a").count(), 0);
      s.recover();
      await p
        .getByRole("button", { name: "Guardar datos generales", exact: true })
        .waitFor();
      await p.getByRole("tab", { name: "Ticket", exact: true }).click();
      assert.ok((await p.locator(".app-sidebar nav a").count()) > 0);
      pass("profile-pending-blocks-navigation-and-tabs");
      await s.context.close();
    }
    for (const mode of ["ok", "save-error"]) {
      const s = await session("/settings/users", 390, mode),
        p = s.page;
      await p
        .getByRole("button", {
          name: "Editar acceso de Empleado 01",
          exact: true,
        })
        .click();
      await p.getByLabel("Nombre operativo").fill("Nombre actualizado");
      await p
        .getByRole("button", { name: "Guardar cambios", exact: true })
        .click();
      if (mode === "ok") {
        await p
          .getByText("Acceso del usuario actualizado.", { exact: true })
          .waitFor();
        assert.equal(s.members()[1].displayName, "Nombre actualizado");
      } else {
        await p
          .getByRole("alert")
          .filter({ hasText: "No se pudo guardar el acceso." })
          .waitFor();
        assert.equal(s.members()[1].displayName, "Empleado 01");
      }
      assert.equal(mutations(s).length, 1);
      assert.deepEqual(Object.keys(mutations(s)[0].body).sort(), [
        "displayName",
        "locationIds",
        "role",
        "status",
      ]);
      pass(`member-save-${mode}-unchanged-contract`);
      await s.context.close();
    }
  }
  assert.equal(external, 0);
  fs.writeFileSync(
    path.join(out, phase + ".json"),
    JSON.stringify(
      { phase, checks, captures, externalRequests: external },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      phase,
      checks: checks.length,
      captures: captures.length,
      externalRequests: external,
    }),
  );
} finally {
  await browser.close();
}
