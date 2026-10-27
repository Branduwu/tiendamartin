// Account UI only. All service calls are synthetic and all external HTTP blocked.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
const require = createRequire(import.meta.url),
  root = process.cwd(),
  fixture = path.join(root, "scripts/ux-redesign-02");
const phase = process.argv[2] ?? "after",
  out = process.env.ACCOUNT_UX_EVIDENCE_DIR,
  baseline = process.env.ACCOUNT_UX_BASELINE_ROOT;
assert.ok(out, "Set ACCOUNT_UX_EVIDENCE_DIR outside the repository");
fs.mkdirSync(out, { recursive: true });
if (phase === "before") {
  assert.ok(baseline);
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: baseline,
      encoding: "utf8",
    }).trim(),
    "aeaacb57263597e89915b30ea159eb3cdcee6218",
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
      { find: "next/link", replacement: path.join(fixture, "shims.tsx") },
      { find: "next/navigation", replacement: path.join(fixture, "shims.tsx") },
      {
        find: "../../lib/supabase/client",
        replacement: path.join(fixture, "shims.tsx"),
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
const uid = "550e8400-e29b-41d4-a716-446655440001";
const original = {
  firstName: "María",
  lastName: "López",
  phone: "+52 555 010 0200",
  email: "perfil@example.invalid",
  displayName: "María López",
  photoEnabled: false,
  roles: [{ company: "Tienda de prueba", role: "owner", status: "active" }],
  platformAdmin: false,
};
const browser = await chromium.launch({ headless: true });
let external = 0;
const checks = [],
  captures = [];
function pass(name) {
  checks.push(name);
}
async function session(width = 1366, mode = "ok") {
  const context = await browser.newContext({
      viewport: { width, height: 900 },
      colorScheme: "light",
      locale: "es-MX",
    }),
    page = await context.newPage();
  let profile = structuredClone(original),
    release;
  if (mode === "empty")
    profile = {
      ...profile,
      firstName: "",
      lastName: "",
      displayName: "",
      phone: "",
      roles: [],
    };
  if (mode === "long")
    profile = {
      ...profile,
      firstName: "M".repeat(80),
      lastName: "L".repeat(80),
      displayName: "M".repeat(80) + " " + "L".repeat(80),
      email: "perfil".repeat(20) + "@example.invalid",
    };
  const calls = [],
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    if (
      route.request().isNavigationRequest() &&
      route.request().url().startsWith("http://127.0.0.1:55995/")
    )
      return route.fulfill({ contentType: "text/html", body: html });
    external++;
    return route.abort();
  });
  await page.exposeFunction("accountMock", async (url, init) => {
    calls.push({
      url,
      method: init.method,
      keys: init.body ? Object.keys(JSON.parse(init.body)).sort() : [],
    });
    const ok = (body) => ({ status: 200, body });
    if (url === "/api/v1/tenants")
      return ok({
        tenants: [
          {
            tenantId: uid,
            tenantName: "Tienda de prueba",
            role: "owner",
            permissions: ["settings.manage", "reports.read"],
          },
        ],
      });
    if (url === "/api/v1/platform")
      return { status: 403, body: { error: "No autorizado" } };
    if (url === "/api/v1/profile?summary=1")
      return ok({ displayName: profile.displayName, photoEnabled: false });
    if (url === "/api/v1/profile" && init.method === "GET") {
      if (
        mode === "load-error" &&
        calls.filter((c) => c.url === url && c.method === "GET").length === 1
      )
        return { status: 503, body: { error: "Synthetic load failure" } };
      return ok(profile);
    }
    if (url === "/api/v1/profile" && init.method === "PATCH") {
      if (mode === "rejected")
        return {
          status: 400,
          body: { error: "Revisa los datos de tu perfil." },
        };
      if (mode === "slow") await new Promise((r) => (release = r));
      const value = JSON.parse(init.body);
      profile = {
        ...profile,
        ...value,
        displayName: [value.firstName, value.lastName]
          .filter(Boolean)
          .join(" "),
      };
      if (mode === "lost") throw Error("Synthetic lost response");
      return ok(profile);
    }
    if (url === "/api/auth/change-password") {
      if (mode === "password-rejected")
        return { status: 400, body: { code: "current_password_invalid" } };
      if (mode === "password-lost") throw Error("Synthetic lost response");
      return ok({});
    }
    return { status: 404, body: { error: "Unmocked call" } };
  });
  await page.goto("http://127.0.0.1:55995/settings/account");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.getByText("Tienda de prueba", { exact: true }).first().waitFor();
  if (phase === "before") await page.locator("input[name=firstName]").waitFor();
  else if (mode === "load-error")
    await page
      .getByRole("button", { name: "Volver a consultar perfil", exact: true })
      .waitFor();
  else
    await page
      .getByRole("button", { name: "Editar perfil", exact: true })
      .waitFor();
  return {
    context,
    page,
    calls,
    errors,
    release: () => release?.(),
    profile: () => profile,
  };
}
async function edit(p) {
  await p.getByRole("button", { name: "Editar perfil", exact: true }).click();
  await p.locator("input[name=firstName]").waitFor();
}
async function security(p) {
  if (phase === "after")
    await p.getByText("Cambiar contraseña", { exact: true }).click();
  await p.locator("input[name=currentPassword]").waitFor();
}
async function fillPassword(p, confirmation = "Nueva sintética 123!") {
  await p
    .locator("input[name=currentPassword]")
    .fill("Anterior sintética 123!");
  await p.locator("input[name=password]").fill("Nueva sintética 123!");
  await p.locator("input[name=confirmation]").fill(confirmation);
}
const patches = (s) =>
  s.calls.filter((c) => c.url === "/api/v1/profile" && c.method === "PATCH");
try {
  for (const width of [1366, 768, 390, 360]) {
    const s = await session(width),
      p = s.page;
    await p.screenshot({
      path: path.join(out, `${phase}-perfil-${width}.png`),
      fullPage: true,
    });
    captures.push(`perfil-${width}`);
    if (phase === "after") {
      assert.equal(await p.locator("input[name=firstName]").count(), 0);
      assert.equal(await p.locator("input[type=file]").count(), 0);
      assert.ok(!s.calls.some((c) => c.url.includes("/photo")));
      const ro = await p.locator("main").innerText();
      assert.ok(ro.includes(original.email) && ro.includes("Propietario"));
      assert.equal(
        await p
          .locator("input[name=role],select[name=role],input[type=email]")
          .count(),
        0,
      );
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      pass(`readonly-profile-photo-disabled-${width}`);
      const button = p.getByRole("button", {
        name: "Editar perfil",
        exact: true,
      });
      await button.focus();
      await p.keyboard.press("Shift+Tab");
      await p.keyboard.press("Tab");
      assert.ok(await button.evaluate((e) => e === document.activeElement));
      await p.keyboard.press("Enter");
      assert.ok(
        await p
          .locator("input[name=firstName]")
          .evaluate((e) => e === document.activeElement),
      );
      await p.locator("input[name=firstName]").fill("Descartar");
      await p.getByRole("button", { name: "Cancelar", exact: true }).click();
      assert.equal(patches(s).length, 0);
      await p.waitForFunction(
        () => document.activeElement?.textContent === "Editar perfil",
      );
      assert.ok(await button.evaluate((e) => e === document.activeElement));
      await edit(p);
      assert.equal(
        await p.locator("input[name=firstName]").inputValue(),
        original.firstName,
      );
      await p.screenshot({
        path: path.join(out, `after-edicion-${width}.png`),
        fullPage: true,
      });
      captures.push(`edicion-${width}`);
      const editAxe = await new AxeBuilder({ page: p })
        .include("#workspace-content")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      assert.deepEqual(
        editAxe.violations.map((v) => v.id),
        [],
      );
      await p.getByRole("button", { name: "Cancelar", exact: true }).click();
      pass(`keyboard-edit-cancel-${width}`);
    }
    await security(p);
    const securitySection =
      phase === "after"
        ? p.locator("#account-security")
        : p.locator("section").filter({
            has: p.getByRole("heading", {
              name: "Cambiar contraseña",
              exact: true,
            }),
          });
    await securitySection.screenshot({
      path: path.join(out, `${phase}-seguridad-${width}.png`),
    });
    captures.push(`seguridad-${width}`);
    if (phase === "after") {
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      const show = p.getByRole("button", {
        name: "Mostrar nueva contraseña",
        exact: true,
      });
      await show.click();
      assert.equal(
        await p.locator("input[name=password]").getAttribute("type"),
        "text",
      );
      await p
        .getByRole("button", { name: "Ocultar nueva contraseña", exact: true })
        .click();
      assert.equal(
        await p.locator("input[name=password]").getAttribute("type"),
        "password",
      );
      pass(`security-show-hide-${width}`);
      const axe = await new AxeBuilder({ page: p })
        .include("#workspace-content")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      assert.deepEqual(
        axe.violations.map((v) => v.id),
        [],
      );
      pass(`axe-edit-security-${width}`);
    }
    assert.deepEqual(s.errors, []);
    await s.context.close();
  }
  if (phase === "after") {
    for (const mode of ["empty", "long"]) {
      const s = await session(360, mode);
      assert.equal(
        await s.page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      if (mode === "empty") {
        await s.page
          .getByRole("heading", { name: "Tu perfil", exact: true })
          .waitFor();
        await s.page.getByText("No registrado", { exact: true }).waitFor();
        await s.page
          .getByText("No tienes una empresa asignada.", { exact: true })
          .waitFor();
      }
      await s.context.close();
      pass(`profile-${mode}-read-state-mobile`);
    }
    const failedLoad = await session(390, "load-error");
    await failedLoad.page
      .getByRole("button", { name: "Volver a consultar perfil", exact: true })
      .click();
    await failedLoad.page
      .getByRole("button", { name: "Editar perfil", exact: true })
      .waitFor();
    assert.equal(patches(failedLoad).length, 0);
    await failedLoad.context.close();
    pass("load-error-explicit-retry");
    const invalid = await session();
    await edit(invalid.page);
    await invalid.page.locator("input[name=firstName]").fill("<no permitido>");
    await invalid.page
      .getByRole("button", { name: "Guardar cambios", exact: true })
      .click();
    await invalid.page
      .getByRole("alert")
      .filter({ hasText: "Revisa nombre, apellidos y teléfono." })
      .waitFor();
    assert.equal(patches(invalid).length, 0);
    await invalid.context.close();
    pass("invalid-name-no-mutation");
    for (const mode of ["ok", "rejected", "lost", "slow"]) {
      const s = await session(390, mode),
        p = s.page;
      await edit(p);
      await p.locator("input[name=firstName]").fill("Lucía");
      await p.locator("input[name=lastName]").fill("Pérez");
      await p.locator("input[name=phone]").fill("+52 555 123 4567");
      await p
        .getByRole("button", { name: "Guardar cambios", exact: true })
        .click();
      if (mode === "slow") {
        await p.getByText("Guardando…", { exact: false }).first().waitFor();
        assert.ok(
          await p
            .getByRole("button", { name: "Cancelar", exact: true })
            .isDisabled(),
        );
        await p
          .locator("#profile-details button[type=submit]")
          .evaluate((e) => e.click());
        assert.equal(patches(s).length, 1);
        s.release();
      }
      if (mode === "rejected") {
        await p
          .getByRole("alert")
          .filter({ hasText: "Revisa los datos de tu perfil." })
          .waitFor();
        assert.equal(
          await p.locator("input[name=firstName]").inputValue(),
          "Lucía",
        );
        await p
          .getByRole("button", {
            name: "Consultar perfil guardado",
            exact: true,
          })
          .click();
        await p
          .getByText("Perfil consultado. Tu edición se conserva.", {
            exact: true,
          })
          .waitFor();
        assert.equal(
          await p.locator("input[name=firstName]").inputValue(),
          "Lucía",
        );
        await p.getByRole("button", { name: "Cancelar", exact: true }).click();
      } else if (mode === "lost") {
        await p
          .getByRole("alert")
          .filter({ hasText: "No pudimos confirmar" })
          .waitFor();
        assert.ok(
          await p
            .getByRole("button", { name: "Cancelar", exact: true })
            .isDisabled(),
        );
        await p
          .getByRole("button", {
            name: "Consultar perfil guardado",
            exact: true,
          })
          .click();
        await p
          .getByRole("button", { name: "Editar perfil", exact: true })
          .waitFor();
        assert.equal(await p.locator("input[name=firstName]").count(), 0);
      } else {
        await p
          .getByText("Datos personales guardados.", { exact: true })
          .waitFor();
        assert.equal(await p.locator("input[name=firstName]").count(), 0);
      }
      assert.equal(patches(s).length, 1);
      assert.deepEqual(patches(s)[0].keys, ["firstName", "lastName", "phone"]);
      assert.equal(s.profile().roles[0].role, "owner");
      assert.equal(s.profile().email, original.email);
      if (mode !== "rejected") {
        assert.ok(
          (await p.locator("main").innerText()).includes("Lucía Pérez"),
        );
        await p.reload();
        await p
          .getByRole("button", { name: "Editar perfil", exact: true })
          .waitFor();
        assert.ok(
          (await p.locator("main").innerText()).includes("Lucía Pérez"),
        );
      }
      pass(`save-${mode}-single-request-reload-authority-preserved`);
      await s.context.close();
    }
    for (const mode of ["ok", "password-rejected", "password-lost"]) {
      const s = await session(390, mode),
        p = s.page;
      await security(p);
      await fillPassword(p, "No coincide 123!");
      await p
        .getByRole("button", { name: "Guardar contraseña", exact: true })
        .click();
      await p
        .getByText("Las contraseñas no coinciden.", { exact: true })
        .waitFor();
      assert.equal(
        s.calls.filter((c) => c.url === "/api/auth/change-password").length,
        0,
      );
      await fillPassword(p);
      await p
        .getByRole("button", { name: "Guardar contraseña", exact: true })
        .click();
      if (mode === "ok")
        await p
          .getByText(
            "Contraseña actualizada. Inicia sesión con tu nueva contraseña.",
            { exact: true },
          )
          .waitFor();
      if (mode === "password-rejected")
        await p
          .getByText("Revisa la contraseña actual.", { exact: true })
          .waitFor();
      if (mode === "password-lost") {
        await p
          .getByText("No pudimos confirmar", { exact: false })
          .first()
          .waitFor();
        assert.equal(await p.locator("input[name=password]").count(), 0);
      }
      assert.equal(
        s.calls.filter((c) => c.url === "/api/auth/change-password").length,
        1,
      );
      assert.equal(patches(s).length, 0);
      assert.deepEqual(s.errors, []);
      pass(`password-${mode}-no-real-credentials`);
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
