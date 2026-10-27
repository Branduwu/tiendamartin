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
  fixture = path.join(root, "scripts/auth-access-01");
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
const password = "Ficticia local 123!",
  email = "synthetic@example.invalid",
  token = "a".repeat(64);
async function session({ path = "/login", mode = "ok", width = 1024 } = {}) {
  const context = await browser.newContext({
      viewport: { width, height: 950 },
    }),
    page = await context.newPage(),
    calls = [],
    errors = [],
    logs = [],
    navigation = [];
  const invitations = [];
  let profile = {
    firstName: "María",
    lastName: "Prueba",
    phone: "555-1234",
    displayName: "María Prueba",
    email,
    photoEnabled: mode !== "photo-disabled",
  };
  let hasPhoto = false,
    profileReads = 0;
  const creationNonces = new Set();
  let mailAttempts = 0;
  let photoReadFailure = mode === "photo-load-error";
  let logoutFailed = mode === "logout-error",
    hold = null,
    release = null;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => logs.push(e.text()));
  const origin = "http://127.0.0.1:55998";
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === origin && u.pathname === "/api/v1/profile/photo") {
      calls.push({
        operation: "/api/v1/profile/photo",
        init: { method: "GET" },
      });
      if (photoReadFailure || (mode === "photo-read-error" && hasPhoto))
        return route.fulfill({ status: 503, body: "Read unavailable" });
      if (!hasPhoto) return route.fulfill({ status: 404, body: "No photo" });
      const sharp = require(
        require.resolve("sharp", { paths: [root + "/apps/web"] }),
      );
      const image = await sharp({
        create: { width: 16, height: 16, channels: 3, background: "#166f69" },
      })
        .png()
        .toBuffer();
      return route.fulfill({ contentType: "image/png", body: image });
    }
    if (u.origin === origin && u.pathname === "/onboarding")
      return route.fulfill({
        contentType: "text/html",
        body: "<p>Destino posterior simulado</p>",
      });

    if (
      u.origin === origin &&
      [
        "/login",
        "/forgot-password",
        "/reset-password",
        "/register",
        "/change",
        "/invite",
        "/settings/users",
        "/settings/account",
      ].includes(u.pathname)
    )
      return route.fulfill({ contentType: "text/html", body: html });
    externalRequests++;
    return route.abort();
  });
  await page.exposeFunction("sdkMock", async (operation, args) => {
    calls.push({ operation, args });
    if (hold) await hold;
    if (operation === "login") {
      if (mode === "unconfirmed")
        return {
          data: { session: null },
          error: { code: "email_not_confirmed", message: "PROVIDER_PRIVATE" },
        };
      if (mode === "credentials")
        return {
          data: { session: null },
          error: { code: "invalid_credentials" },
        };
      if (mode === "unavailable")
        return {
          data: { session: null },
          error: { status: 502, message: "PROVIDER_PRIVATE" },
        };
      return { data: { session: { synthetic: true } }, error: null };
    }
    if (operation === "logout")
      return { error: logoutFailed ? { message: "PROVIDER_PRIVATE" } : null };
    if (mode === "network") throw new Error("PROVIDER_PRIVATE");
    return {
      data: { session: null },
      error:
        mode === "limited"
          ? { status: 429, message: "PROVIDER_PRIVATE" }
          : null,
    };
  });
  await page.exposeFunction("fetchMock", async (url, body, init) => {
    calls.push({ operation: url, body, init });
    if (url === "/api/v1/tenants")
      return {
        status: 200,
        body: {
          tenants: [
            {
              tenantId: "550e8400-e29b-41d4-a716-446655440001",
              tenantName: "Negocio sintético",
              tenantStatus: "active",
              role: "cashier",
              displayName: "Usuario anterior",
              permissions: [
                "sales.create",
                "products.read",
                "cash.read",
                "inventory.read",
              ],
            },
          ],
        },
      };
    if (url === "/api/v1/platform")
      return { status: 403, body: { error: "No platform" } };
    if (url === "/api/v1/profile?summary=1")
      return {
        status: 200,
        body: {
          displayName: profile.displayName,
          photoEnabled: profile.photoEnabled,
        },
      };
    if (url === "/api/v1/profile") {
      if (init.method === "GET") {
        profileReads++;
        if (mode === "profile-load-error" && profileReads === 1)
          return { status: 503, body: { error: "Consulta no disponible." } };
        return {
          status: 200,
          body: {
            ...profile,
            roles: [
              {
                company: "Negocio sintético",
                role: "cashier",
                status: "active",
              },
            ],
            platformAdmin: false,
          },
        };
      }
      if (hold) await hold;
      if (mode === "profile-rejected")
        return { status: 400, body: { error: "Revisa los datos personales." } };
      const input = JSON.parse(body);
      assert.deepEqual(Object.keys(input).sort(), [
        "firstName",
        "lastName",
        "phone",
      ]);
      profile = {
        ...profile,
        ...input,
        displayName: [input.firstName, input.lastName]
          .filter(Boolean)
          .join(" "),
      };
      if (mode === "profile-uncertain")
        throw Error("SYNTHETIC_LOST_PROFILE_RESPONSE");
      return { status: 200, body: profile };
    }
    if (url === "/api/v1/profile/photo") {
      if (mode === "photo-rejected")
        return {
          status: 400,
          body: { error: "Elige una imagen válida de hasta 3 MB." },
        };
      if (init.method === "PUT") {
        assert.ok(init.bodySize > 0);
        hasPhoto = true;
      } else if (init.method === "DELETE") hasPhoto = false;
      else throw Error("UNEXPECTED_PHOTO_OPERATION");
      if (mode === "photo-uncertain" || mode === "photo-read-error")
        throw Error("SYNTHETIC_LOST_PHOTO_RESPONSE");
      return { status: 200, body: { saved: true } };
    }
    if (url === "/api/v1/invitations") {
      assert.equal(
        init.headers["x-tenant-id"],
        "550e8400-e29b-41d4-a716-446655440001",
      );
      if (init.method === "GET")
        return {
          status: 200,
          body: {
            invitations,
            locations: [
              {
                id: "550e8400-e29b-41d4-a716-446655440011",
                name: "Sucursal ficticia",
                status: "active",
              },
            ],
          },
        };
      const value = JSON.parse(body);
      if (creationNonces.has(value.creationNonce))
        return {
          status: 409,
          body: {
            error:
              "Esta solicitud de invitación ya se registró. Consulta las invitaciones; no repitas el envío.",
          },
        };
      if (
        mode === "create-denied" ||
        (mode === "second-create-denied" && invitations.length)
      )
        return {
          status: 403,
          body: { error: "No tienes permiso para crear esta invitación." },
        };
      const invitation = {
        id: `550e8400-e29b-41d4-a716-${String(invitations.length + 1).padStart(12, "0")}`,
        email: value.email.toLowerCase(),
        role: value.role,
        locationIds: value.locationIds,
        expiresAt: "2099-01-01T00:00:00.000Z",
        acceptedAt: null,
        revokedAt: null,
      };
      invitations.push(invitation);
      creationNonces.add(value.creationNonce);
      mailAttempts++;
      if (hold) await hold;
      if (mode === "create-unknown") throw new Error("SYNTHETIC_RESPONSE_LOST");
      return {
        status: 201,
        body: {
          invitation,
          token,
          ...(mode === "legacy"
            ? {}
            : {
                emailDelivery: {
                  status:
                    mode === "not-sent"
                      ? "not_sent"
                      : mode === "mail-unknown"
                        ? "unknown"
                        : "accepted",
                },
              }),
        },
      };
    }
    if (url.startsWith("/api/v1/invitations/") && init?.method === "PATCH") {
      const record = invitations.find((i) => url.endsWith("/" + i.id));
      assert.ok(record);
      record.revokedAt = "2026-10-26T00:00:00Z";
      return { status: 200, body: { saved: true } };
    }
    if (hold) await hold;
    if (mode === "network" && url.includes("password"))
      throw new Error("PROVIDER_PRIVATE");
    if (url.includes("password")) {
      if (mode === "expired")
        return { status: 401, body: { error: "PROVIDER_PRIVATE" } };
      if (mode === "uncertain" || mode === "logout-error")
        return {
          status: 503,
          body: {
            code: "password_update_unconfirmed",
            error: "PROVIDER_PRIVATE",
          },
        };
      if (mode === "saved-logout")
        return {
          status: 503,
          body: {
            code: "password_saved_logout_failed",
            error: "PROVIDER_PRIVATE",
          },
        };
      return { status: 200, body: { message: "Contraseña actualizada" } };
    }
    if (url === "/api/v1/invitations/accept")
      return mode === "expired"
        ? {
            status: 404,
            body: {
              error:
                "La invitación no está disponible. Solicita un enlace nuevo.",
            },
          }
        : { status: 200, body: { tenantId: "synthetic-tenant" } };
    if (url === "/api/auth/reauthenticate") return { status: 200, body: {} };
    throw Error("UNMOCKED_REQUEST");
  });
  await page.addInitScript(() =>
    window.addEventListener("test-navigation", (e) => {
      document.body.dataset.next = e.detail;
    }),
  );
  if (path === "/settings/users")
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.invitationCopied = text;
          },
        },
      }),
    );
  await page.goto(origin + path);
  await page
    .getByRole("heading", { name: "Acceso de prueba", exact: true })
    .waitFor();
  if (path === "/settings/account" && mode !== "profile-load-error") {
    await page
      .getByRole("button", { name: "Editar perfil", exact: true })
      .click();
  }
  return {
    page,
    calls,
    context,
    mode,
    invitations,
    mailAttempts: () => mailAttempts,
    hold() {
      hold = new Promise((r) => (release = r));
    },
    release() {
      release?.();
      hold = null;
    },
    logoutRecover() {
      logoutFailed = false;
    },
    photoReadRecover() {
      photoReadFailure = false;
    },
    async close() {
      assert.deepEqual(errors, []);
      const text = await page.locator("body").innerText();
      assert.ok(!text.includes("PROVIDER_PRIVATE"));
      for (const sensitive of [password, "PRIVATE_RECOVERY_CODE", token])
        assert.ok(!logs.join("\n").includes(sensitive));
      await context.close();
    },
  };
}
const input = (p, name) => p.locator(`input[name="${name}"]`);
async function fillPasswords(p, mode = "reset") {
  if (mode === "change")
    await input(p, "currentPassword").fill("Anterior ficticia 123!");
  await input(p, "password").fill(password);
  await input(p, "confirmation").fill(password);
}
async function invitationChecks() {
  const posts = (s) =>
    s.calls.filter(
      (c) => c.operation === "/api/v1/invitations" && c.init.method === "POST",
    );
  async function create(s, recipient = email) {
    await s.page.getByLabel("Correo de la persona").fill(recipient);
    await s.page.getByLabel("Sucursal ficticia").check();
    await s.page
      .getByRole("button", { name: "Crear invitación", exact: true })
      .click();
  }
  for (const [mode, message] of [
    ["ok", "correo aceptado por el proveedor"],
    ["not-sent", "el correo no se envió"],
    ["mail-unknown", "No pudimos confirmar el envío"],
    ["legacy", "No pudimos confirmar el envío"],
  ]) {
    const s = await session({ path: "/settings/users", mode, width: 320 });
    await create(s);
    await s.page.getByText(message, { exact: false }).waitFor();
    const link = s.page.getByLabel("Enlace privado · visible sólo ahora");
    assert.equal(
      await link.inputValue(),
      "http://127.0.0.1:55998/invite#token=" + token,
    );
    await s.page
      .getByRole("button", { name: "Copiar enlace de invitación" })
      .click();
    assert.equal(
      await s.page.evaluate(() => window.invitationCopied),
      await link.inputValue(),
    );
    await s.page.getByText(message, { exact: false }).waitFor();
    assert.equal(posts(s).length, 1);
    assert.equal(s.mailAttempts(), 1);
    assert.equal(s.invitations.length, 1);
    assert.equal(s.invitations[0].email, email);
    assert.equal(s.invitations[0].role, "cashier");
    assert.deepEqual(s.invitations[0].locationIds, [
      "550e8400-e29b-41d4-a716-446655440011",
    ]);
    assert.ok(
      await s.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    pass(`invitation-${mode}-status-copy-no-resend-mobile`);
    await s.close();
  }
  let s = await session({ path: "/settings/users" });
  await s.page.getByLabel("Correo de la persona").fill(email);
  s.hold();
  await s.page.locator("form").evaluate((form) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await s.page.getByText("Creando y enviando…").waitFor();
  assert.equal(posts(s).length, 1);
  s.release();
  await s.page
    .getByText("correo aceptado por el proveedor", { exact: false })
    .waitFor();
  assert.equal(s.invitations.length, 1);
  assert.equal(s.mailAttempts(), 1);
  pass("invitation-double-submit-one-create-and-mail");
  await s.close();
  s = await session({ path: "/settings/users", mode: "create-denied" });
  await create(s);
  await s.page.getByRole("alert").waitFor();
  assert.equal(s.mailAttempts(), 0);
  assert.equal(
    await s.page.getByLabel("Enlace privado · visible sólo ahora").count(),
    0,
  );
  pass("invitation-create-denied-no-mail-or-false-success");
  await s.close();
  s = await session({ path: "/settings/users", mode: "create-unknown" });
  await create(s);
  await s.page.getByRole("alert").waitFor();
  await s.page.getByRole("button", { name: "Reintentar consulta" }).click();
  await s.page.locator("article").filter({ hasText: email }).waitFor();
  assert.equal(posts(s).length, 1);
  assert.equal(s.mailAttempts(), 1);
  assert.equal(
    await s.page.getByLabel("Enlace privado · visible sólo ahora").count(),
    0,
  );
  await create(s);
  await s.page
    .getByRole("alert")
    .filter({ hasText: "Esta solicitud de invitación ya se registró" })
    .waitFor();
  const retried = posts(s);
  assert.equal(retried.length, 2);
  assert.equal(
    JSON.parse(retried[0].body).creationNonce,
    JSON.parse(retried[1].body).creationNonce,
  );
  assert.equal(s.invitations.length, 1);
  assert.equal(s.mailAttempts(), 1);
  pass("invitation-lost-response-same-creation-nonce-no-duplicate-or-resend");
  await s.close();
  s = await session({ path: "/settings/users", mode: "second-create-denied" });
  await create(s);
  await s.page
    .getByText("correo aceptado por el proveedor", { exact: false })
    .waitFor();
  await create(s, "other@example.invalid");
  await s.page.getByRole("alert").waitFor();
  await s.page.getByText("Invitación para " + email, { exact: true }).waitFor();
  assert.equal(s.invitations.length, 1);
  assert.equal(s.mailAttempts(), 1);
  assert.equal(
    await s.page.getByLabel("Enlace privado · visible sólo ahora").count(),
    1,
  );
  pass("invitation-failed-new-create-preserves-previous-private-link");
  await s.close();
  s = await session({ path: "/settings/users" });
  await create(s);
  await s.page
    .getByText("correo aceptado por el proveedor", { exact: false })
    .waitFor();
  await create(s, "other@example.invalid");
  await s.page
    .getByText("Invitación para other@example.invalid", { exact: true })
    .waitFor();
  await s.page
    .locator("article")
    .filter({ hasText: email })
    .getByRole("button", { name: "Revocar invitación" })
    .click();
  await s.page.getByText("Invitación revocada.", { exact: true }).waitFor();
  assert.equal(
    await s.page.getByLabel("Enlace privado · visible sólo ahora").count(),
    1,
  );
  await s.page
    .locator("article")
    .filter({ hasText: "other@example.invalid" })
    .getByRole("button", { name: "Revocar invitación" })
    .click();
  await s.page
    .getByLabel("Enlace privado · visible sólo ahora")
    .waitFor({ state: "detached" });
  pass("invitation-revoke-clears-only-matching-link");
  await s.close();
  s = await session({ path: "/invite#token=" + token });
  await s.page
    .getByRole("button", { name: "Aceptar invitación", exact: true })
    .click();
  await s.page.waitForURL("**/onboarding");
  const accept = s.calls.find(
    (c) => c.operation === "/api/v1/invitations/accept",
  );
  assert.deepEqual(JSON.parse(accept.body), { token });
  pass("invitation-existing-private-acceptance-contract-preserved");
  await s.close();
  assert.equal(externalRequests, 0);
}
async function profileChecks() {
  const mutations = (s, path = "/api/v1/profile", method = "PATCH") =>
    s.calls.filter((c) => c.operation === path && c.init.method === method);
  async function ready(s) {
    await s.page.getByLabel("Nombre", { exact: false }).waitFor();
    await s.page.getByLabel("Nombre", { exact: false }).fill("Ana");
  }
  for (const width of [1280, 768, 390, 320]) {
    const s = await session({ path: "/settings/account", width });
    const p = s.page;
    await ready(s);
    await p.getByLabel("Apellidos", { exact: true }).fill("Pérez");
    await p
      .getByLabel("Teléfono de contacto", { exact: false })
      .fill("555-9876");
    await p
      .getByRole("button", { name: "Guardar cambios", exact: true })
      .click();
    await p.getByText("Datos personales guardados.", { exact: true }).waitFor();
    await p.getByLabel("Menú de usuario").click();
    await p
      .locator(".account-identity")
      .filter({ hasText: "Ana Pérez" })
      .waitFor();
    assert.equal(await p.locator('input[type="email"]').count(), 0);
    await p.getByText("Correo de acceso", { exact: false }).waitFor();
    assert.equal(mutations(s).length, 1);
    assert.ok((await p.locator("body").innerText()).includes("Cajero"));
    assert.equal(await p.locator('select[name="role"]').count(), 0);
    assert.ok(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    if (width === 1280) {
      const sidebar = await p.locator(".app-sidebar").boundingBox();
      const main = await p.locator("main.workspace").boundingBox();
      assert.ok(sidebar && main && main.x >= sidebar.x + sidebar.width);
      assert.equal(await p.locator("#workspace-content").count(), 1);
    }
    if (process.argv[3] && (width === 1280 || width === 320)) {
      fs.mkdirSync(process.argv[3], { recursive: true });
      await p.screenshot({
        path: path.join(process.argv[3], `profile-${width}.png`),
        fullPage: true,
      });
    }
    await p.reload();
    await p.getByRole("button", { name: "Editar perfil", exact: true }).click();
    await p.getByLabel("Nombre", { exact: false }).waitFor();
    assert.equal(
      await p.getByLabel("Nombre", { exact: false }).inputValue(),
      "Ana",
    );
    assert.equal(
      await p.getByLabel("Apellidos", { exact: true }).inputValue(),
      "Pérez",
    );
    assert.equal(mutations(s).length, 1);
    pass(`profile-save-reload-live-identity-readonly-role-${width}px`);
    await s.close();
  }
  let s = await session({ path: "/settings/account" });
  let p = s.page;
  await ready(s);
  await p.getByLabel("Nombre", { exact: false }).fill("");
  await p.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  assert.equal(
    await p
      .getByLabel("Nombre", { exact: false })
      .evaluate((i) => i.validity.valueMissing),
    true,
  );
  await p.getByLabel("Nombre", { exact: false }).fill("Ana");
  await p
    .getByLabel("Teléfono de contacto", { exact: false })
    .fill("invalid-phone");
  await p.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await p.getByRole("alert").filter({ hasText: "Revisa nombre" }).waitFor();
  assert.equal(mutations(s).length, 0);
  pass("profile-required-name-invalid-phone-no-request");
  await s.close();
  s = await session({ path: "/settings/account" });
  p = s.page;
  await ready(s);
  s.hold();
  await p
    .locator("form")
    .first()
    .evaluate((f) => {
      f.requestSubmit();
      f.requestSubmit();
    });
  await p.getByText("Guardando…", { exact: true }).first().waitFor();
  assert.equal(mutations(s).length, 1);
  s.release();
  await p.getByText("Datos personales guardados.", { exact: true }).waitFor();
  pass("profile-double-click-one-update");
  await s.close();
  s = await session({ path: "/settings/account", mode: "profile-rejected" });
  p = s.page;
  await ready(s);
  await p.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await p
    .getByRole("alert")
    .filter({ hasText: "Revisa los datos personales" })
    .waitFor();
  assert.equal(
    await p.getByText("Datos personales guardados.", { exact: true }).count(),
    0,
  );
  pass("profile-rejection-no-false-success");
  await s.close();
  s = await session({ path: "/settings/account", mode: "profile-uncertain" });
  p = s.page;
  await ready(s);
  await p.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await p
    .getByRole("alert")
    .filter({ hasText: "No pudimos confirmar" })
    .waitFor();
  assert.equal(
    await p
      .getByRole("button", { name: "Guardar cambios", exact: true })
      .isDisabled(),
    true,
  );
  await p
    .getByRole("button", { name: "Consultar perfil guardado", exact: true })
    .click();
  await p
    .getByText("Perfil consultado. Revisa los datos antes de guardar.", {
      exact: true,
    })
    .waitFor();
  await p.getByRole("button", { name: "Editar perfil", exact: true }).click();
  assert.equal(
    await p.getByLabel("Nombre", { exact: false }).inputValue(),
    "Ana",
  );
  assert.equal(mutations(s).length, 1);
  pass("profile-unknown-write-reconciled-without-repeat");
  await s.close();
  s = await session({ path: "/settings/account", mode: "profile-load-error" });
  p = s.page;
  await p.getByRole("button", { name: "Volver a consultar perfil" }).click();
  await p.getByRole("button", { name: "Editar perfil", exact: true }).click();
  await p.getByLabel("Nombre", { exact: false }).waitFor();
  pass("profile-load-error-explicit-read-retry");
  await s.close();
  s = await session({ path: "/settings/account", mode: "photo-disabled" });
  p = s.page;
  await p.getByText("Fotografía no habilitada", { exact: false }).waitFor();
  assert.equal(await p.locator('input[type="file"]').count(), 0);
  pass("profile-photo-pending-dependency-visible");
  await s.close();
  const sharp = require(
    require.resolve("sharp", { paths: [path.join(root, "apps/web")] }),
  );
  const image = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  s = await session({ path: "/settings/account" });
  p = s.page;
  await p
    .getByLabel("Seleccionar fotografía", { exact: false })
    .setInputFiles({ name: "draft.png", mimeType: "image/png", buffer: image });
  await p.getByLabel("Nombre", { exact: false }).fill("Borrador");
  await p.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await p
    .getByText("La fotografía seleccionada aún no se ha guardado.", {
      exact: false,
    })
    .waitFor();
  assert.equal(
    await p
      .getByRole("button", { name: "Guardar fotografía", exact: true })
      .isEnabled(),
    true,
  );
  assert.ok(
    (
      await p
        .getByRole("img", { name: "Tu fotografía de perfil", exact: true })
        .getAttribute("src")
    ).startsWith("blob:"),
  );
  assert.equal(mutations(s, "/api/v1/profile/photo", "PUT").length, 0);
  await p.getByRole("button", { name: "Cancelar", exact: true }).click();
  assert.equal(await p.locator("input[type=file]").count(), 0);
  pass("profile-personal-save-keeps-unsaved-photo-explicit-until-cancel");
  await s.close();
  s = await session({ path: "/settings/account", width: 320 });
  p = s.page;
  await p.getByLabel("Seleccionar fotografía", { exact: false }).waitFor();
  await p.getByLabel("Seleccionar fotografía", { exact: false }).setInputFiles({
    name: "invalid.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg/>"),
  });
  await p.getByRole("alert").filter({ hasText: "hasta 3 MB" }).waitFor();
  assert.equal(mutations(s, "/api/v1/profile/photo", "PUT").length, 0);
  await p
    .getByLabel("Seleccionar fotografía", { exact: false })
    .setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: image });
  await p
    .getByRole("button", { name: "Guardar fotografía", exact: true })
    .click();
  await p.getByText("Fotografía guardada.", { exact: true }).waitFor();
  await p.reload();
  await p.getByRole("button", { name: "Editar perfil", exact: true }).click();
  await p
    .getByRole("img", { name: "Tu fotografía de perfil", exact: true })
    .waitFor();
  await p.waitForFunction(() => {
    const img = document.querySelector('img[alt="Tu fotografía de perfil"]');
    return img?.complete && img.naturalWidth > 0;
  });
  await p
    .getByRole("button", { name: "Quitar fotografía", exact: true })
    .click();
  await p.getByText("Fotografía eliminada.", { exact: true }).waitFor();
  assert.equal(mutations(s, "/api/v1/profile/photo", "PUT").length, 1);
  assert.equal(mutations(s, "/api/v1/profile/photo", "DELETE").length, 1);
  pass("profile-photo-invalid-valid-reload-remove-mobile");
  await s.close();
  for (const mode of [
    "photo-rejected",
    "photo-uncertain",
    "photo-read-error",
  ]) {
    s = await session({ path: "/settings/account", mode });
    p = s.page;
    await p
      .getByLabel("Seleccionar fotografía", { exact: false })
      .setInputFiles({
        name: "photo.png",
        mimeType: "image/png",
        buffer: image,
      });
    await p
      .getByRole("button", { name: "Guardar fotografía", exact: true })
      .click();
    await p.getByRole("alert").waitFor();
    assert.equal(
      await p.getByText("Fotografía guardada.", { exact: true }).count(),
      0,
    );
    assert.equal(mutations(s, "/api/v1/profile/photo", "PUT").length, 1);
    if (mode === "photo-rejected") {
      await p
        .getByRole("button", { name: "Consultar perfil guardado", exact: true })
        .click();
      await p
        .getByText("Perfil consultado. Tu edición se conserva.", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        await p
          .getByRole("button", { name: "Guardar fotografía", exact: true })
          .isEnabled(),
        true,
      );
      assert.ok(
        (
          await p
            .getByRole("img", { name: "Tu fotografía de perfil", exact: true })
            .getAttribute("src")
        ).startsWith("blob:"),
      );
      assert.equal(mutations(s, "/api/v1/profile/photo", "PUT").length, 1);
    }
    if (mode !== "photo-rejected") {
      await p
        .getByRole("button", { name: "Consultar perfil guardado", exact: true })
        .click();
      if (mode === "photo-read-error") {
        await p
          .getByRole("alert")
          .filter({ hasText: "No pudimos confirmar la fotografía." })
          .waitFor();
        assert.equal(
          await p
            .getByLabel("Seleccionar fotografía", { exact: false })
            .isDisabled(),
          true,
        );
        await p
          .getByText("No significa que se haya eliminado.", { exact: false })
          .waitFor();
      } else {
        await p
          .getByText("Perfil consultado. Revisa los datos antes de guardar.", {
            exact: true,
          })
          .waitFor();
        await p
          .getByRole("button", { name: "Editar perfil", exact: true })
          .click();
        assert.equal(
          await p
            .getByLabel("Seleccionar fotografía", { exact: false })
            .isDisabled(),
          false,
        );
      }
      assert.equal(mutations(s, "/api/v1/profile/photo", "PUT").length, 1);
    }
    pass(`profile-${mode}-no-automatic-repeat`);
    await s.close();
  }
  s = await session({ path: "/settings/account", mode: "photo-load-error" });
  p = s.page;
  await p
    .getByText("No significa que se haya eliminado.", { exact: false })
    .waitFor();
  assert.equal(
    await p.getByLabel("Sin fotografía", { exact: true }).count(),
    0,
  );
  pass("profile-photo-read-error-is-not-absence");
  await p.getByLabel("Nombre", { exact: false }).fill("Borrador conservado");
  s.photoReadRecover();
  await p
    .getByRole("button", { name: "Consultar perfil guardado", exact: true })
    .click();
  await p
    .getByText("Perfil consultado. Tu edición se conserva.", { exact: true })
    .waitFor();
  assert.equal(
    await p.getByLabel("Nombre", { exact: false }).inputValue(),
    "Borrador conservado",
  );
  await p.getByLabel("Sin fotografía", { exact: true }).waitFor();
  assert.equal(mutations(s).length, 0);
  pass("profile-photo-read-retry-preserves-draft");
  await s.close();
  s = await session({ path: "/settings/account" });
  p = s.page;
  await p
    .locator('input[name="currentPassword"]')
    .fill("Anterior sintética 123!");
  await p.locator('input[name="password"]').fill(password);
  await p.locator('input[name="confirmation"]').fill(password);
  const passwordButton = p
    .locator("form")
    .filter({ has: p.locator('input[name="currentPassword"]') })
    .getByRole("button", { name: /Guardar|Cambiar/ });
  await passwordButton.click();
  await p
    .getByText(
      "Contraseña actualizada. Inicia sesión con tu nueva contraseña.",
      { exact: true },
    )
    .waitFor();
  assert.equal(mutations(s).length, 0);
  pass("profile-existing-password-change-is-separate");
  await s.close();
  assert.equal(externalRequests, 0);
}
if (process.argv.includes("--profile-only")) {
  try {
    await profileChecks();
    console.log(JSON.stringify({ checks, externalRequests }));
  } finally {
    await browser.close();
  }
  process.exit(0);
}
if (process.argv.includes("--invitations-only")) {
  try {
    await invitationChecks();
    console.log(JSON.stringify({ checks, externalRequests }));
  } finally {
    await browser.close();
  }
  process.exit(0);
}
try {
  for (const [mode, message] of [
    ["credentials", "Revisa tu correo y contraseña"],
    ["unavailable", "no está disponible temporalmente"],
    ["unconfirmed", "Verifica tu correo antes de iniciar sesión"],
  ]) {
    const s = await session({ mode }),
      p = s.page;
    await input(p, "email").first().fill(email);
    await input(p, "password").fill(password);
    await p
      .getByRole("button", { name: "Iniciar sesión", exact: true })
      .click();
    await p.getByRole("alert").filter({ hasText: message }).waitFor();
    assert.equal(s.calls.filter((c) => c.operation === "login").length, 1);
    pass(`login-${mode}-bounded-message`);
    await s.close();
  }
  let s = await session(),
    p = s.page;
  await input(p, "email").first().fill(email);
  await input(p, "password").fill(password);
  s.hold();
  await p
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .dblclick();
  assert.equal(s.calls.filter((c) => c.operation === "login").length, 1);
  s.release();
  await p.getByText("Sesión iniciada.", { exact: false }).waitFor();
  assert.equal(
    await p.locator("body").getAttribute("data-next"),
    "/onboarding",
  );
  pass("login-single-flight-and-existing-destination");
  await s.close();
  let recoveryText, confirmationText;
  for (const mode of ["ok", "limited", "network"]) {
    s = await session({ path: "/forgot-password", mode });
    p = s.page;
    await input(p, "email").fill(email);
    await p.getByRole("button", { name: "Enviar enlace", exact: true }).click();
    await p
      .getByRole("status")
      .filter({ hasText: "Si existe una cuenta" })
      .waitFor();
    const text = await p.getByRole("status").innerText();
    if (recoveryText) assert.equal(text, recoveryText);
    else recoveryText = text;
    const call = s.calls.find((c) => c.operation === "recover");
    assert.equal(
      call.args[1].redirectTo,
      "http://127.0.0.1:55998/reset-password",
    );
    pass(`recovery-neutral-response-${mode}`);
    await s.close();
    s = await session({ mode });
    p = s.page;
    await p.getByText("Verificar mi correo", { exact: true }).click();
    const form = p.locator("details form");
    await form.locator('input[name="email"]').fill(email);
    await form
      .getByRole("button", { name: "Reenviar verificación", exact: true })
      .click();
    await p
      .getByRole("status")
      .filter({ hasText: "Si el correo tiene una cuenta pendiente" })
      .waitFor();
    const visible = await p.getByRole("status").innerText();
    if (confirmationText) assert.equal(visible, confirmationText);
    else confirmationText = visible;
    assert.equal(s.calls.filter((c) => c.operation === "resend").length, 1);
    assert.equal(
      s.calls.find((c) => c.operation === "resend").args[0].type,
      "signup",
    );
    assert.equal(
      s.calls.find((c) => c.operation === "resend").args[0].options
        .emailRedirectTo,
      "http://127.0.0.1:55998/auth/callback",
    );
    assert.equal(await p.locator("form form").count(), 0);
    pass(`verification-neutral-official-resend-${mode}`);
    await s.close();
  }
  s = await session({ path: "/login?configured=no" });
  p = s.page;
  await p.getByText("Verificar mi correo", { exact: true }).click();
  assert.equal(
    await p
      .getByRole("button", { name: "Reenviar verificación", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(s.calls.length, 0);
  pass("missing-configuration-no-provider-call");
  await s.close();
  s = await session({ path: "/register" });
  p = s.page;
  await input(p, "email").fill(email);
  await input(p, "password").fill(password);
  await p.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  await p
    .getByRole("status")
    .filter({ hasText: "Si el correo puede registrarse" })
    .waitFor();
  assert.equal(
    await p
      .getByRole("link", {
        name: "Solicitar otra verificación de correo",
        exact: true,
      })
      .getAttribute("href"),
    "/login?confirmation=retry",
  );
  pass("signup-pending-confirmation-retry-path");
  await s.close();
  for (const path of [
    "/reset-password",
    "/reset-password?error=expired&code=PRIVATE_RECOVERY_CODE",
  ]) {
    s = await session({ path });
    p = s.page;
    await p
      .getByRole("alert")
      .filter({ hasText: "Este enlace ya no es válido" })
      .waitFor();
    assert.equal(await input(p, "password").count(), 0);
    assert.equal(new URL(p.url()).search, "");
    assert.equal(s.calls.length, 0);
    pass("invalid-recovery-no-mutation-clean-url");
    await s.close();
  }
  s = await session({
    path: "/reset-password?code=PRIVATE_RECOVERY_CODE&sb_flow_id=synthetic_flow_01",
  });
  p = s.page;
  await fillPasswords(p);
  await input(p, "confirmation").fill("No coincide 123!");
  await p
    .getByRole("button", { name: "Guardar contraseña", exact: true })
    .click();
  await p
    .getByRole("alert")
    .filter({ hasText: "Las contraseñas no coinciden" })
    .waitFor();
  assert.equal(s.calls.length, 0);
  await input(p, "confirmation").fill(password);
  s.hold();
  await p
    .getByRole("button", { name: "Guardar contraseña", exact: true })
    .dblclick();
  assert.equal(
    s.calls.filter((c) => c.operation === "/api/auth/reset-password").length,
    1,
  );
  s.release();
  await p
    .getByRole("status")
    .filter({ hasText: "Contraseña actualizada." })
    .waitFor();
  assert.equal(new URL(p.url()).search, "");
  const reset = JSON.parse(
    s.calls.find((c) => c.operation === "/api/auth/reset-password").body,
  );
  assert.equal(reset.password, password);
  assert.equal(reset.code, "PRIVATE_RECOVERY_CODE");
  assert.equal(reset.flowId, "synthetic_flow_01");
  pass("password-confirmation-exact-payload-single-submit");
  await s.close();
  s = await session({
    path: "/reset-password?code=PRIVATE_RECOVERY_CODE",
    mode: "expired",
  });
  p = s.page;
  await fillPasswords(p);
  await p
    .getByRole("button", { name: "Guardar contraseña", exact: true })
    .click();
  await p
    .getByRole("alert")
    .filter({ hasText: "Este enlace ya no es válido" })
    .waitFor();
  assert.equal(await input(p, "password").count(), 0);
  pass("used-or-expired-code-no-repeat");
  await s.close();
  for (const [path, mode] of [
    ["/reset-password?code=PRIVATE_RECOVERY_CODE", "network"],
    ["/reset-password?code=PRIVATE_RECOVERY_CODE", "uncertain"],
    ["/change", "uncertain"],
  ]) {
    s = await session({ path, mode });
    p = s.page;
    await fillPasswords(p, path === "/change" ? "change" : "reset");
    await p
      .getByRole("button", { name: "Guardar contraseña", exact: true })
      .click();
    await p
      .getByRole("status")
      .filter({ hasText: "No pudimos confirmar si se guardó" })
      .waitFor();
    assert.equal(await input(p, "password").count(), 0);
    assert.equal(s.calls.length, 1);
    pass(
      `uncertain-password-not-retried-${mode}-${path.startsWith("/change") ? "change" : "reset"}`,
    );
    await s.close();
  }
  s = await session({ path: "/change", mode: "logout-error" });
  p = s.page;
  await fillPasswords(p, "change");
  await p
    .getByRole("button", { name: "Guardar contraseña", exact: true })
    .click();
  await p
    .getByRole("button", {
      name: "Cerrar sesión y comprobar acceso",
      exact: true,
    })
    .click();
  await p
    .getByRole("alert")
    .filter({ hasText: "No pudimos cerrar esta sesión" })
    .waitFor();
  assert.ok(new URL(p.url()).pathname === "/change");
  assert.equal(
    s.calls.filter((c) => c.operation === "/api/auth/change-password").length,
    1,
  );
  s.logoutRecover();
  await p
    .getByRole("button", {
      name: "Cerrar sesión y comprobar acceso",
      exact: true,
    })
    .click();
  await p.waitForURL("**/login");
  const outs = s.calls.filter((c) => c.operation === "logout");
  assert.equal(outs.length, 2);
  assert.deepEqual(outs[0].args[0], { scope: "local" });
  pass("explicit-local-logout-before-password-check-error-and-recovery");
  await s.close();
  s = await session({
    path: "/reset-password?code=PRIVATE_RECOVERY_CODE",
    mode: "saved-logout",
  });
  p = s.page;
  await fillPasswords(p);
  await p
    .getByRole("button", { name: "Guardar contraseña", exact: true })
    .click();
  await p
    .getByRole("status")
    .filter({ hasText: "Contraseña actualizada; no pudimos cerrar" })
    .waitFor();
  assert.equal(await input(p, "password").count(), 0);
  pass("saved-password-logout-failure-distinguished");
  await s.close();
  s = await session({ path: "/invite?authenticated=no#token=" + token });
  p = s.page;
  await p.getByText("Primero inicia sesión", { exact: false }).waitFor();
  assert.equal(
    await p
      .getByRole("button", { name: "Aceptar invitación", exact: true })
      .count(),
    0,
  );
  assert.equal(new URL(p.url()).hash, "");
  pass("invitation-private-handoff-requires-authentication");
  await s.close();
  s = await session({ path: "/invite#token=invalid" });
  p = s.page;
  await p
    .getByRole("alert")
    .filter({ hasText: "El enlace no es válido" })
    .waitFor();
  assert.equal(s.calls.length, 0);
  pass("invalid-invitation-no-acceptance");
  await s.close();
  s = await session({ path: "/invite#token=" + token, mode: "expired" });
  p = s.page;
  await p
    .getByRole("button", { name: "Aceptar invitación", exact: true })
    .click();
  await p
    .getByRole("alert")
    .filter({ hasText: "La invitación no está disponible" })
    .waitFor();
  assert.equal(
    await p
      .getByRole("button", { name: "Aceptar invitación", exact: true })
      .count(),
    0,
  );
  assert.equal(s.calls.length, 1);
  pass("expired-invitation-stops-no-role-grant");
  await s.close();
  s = await session({ path: "/invite#token=" + token });
  p = s.page;
  await p
    .getByRole("button", { name: "Aceptar invitación", exact: true })
    .click();
  await p.waitForURL("**/onboarding");
  const accepted = s.calls.filter(
    (c) => c.operation === "/api/v1/invitations/accept",
  );
  assert.equal(accepted.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(accepted[0].body)), ["token"]);
  assert.equal(
    await p.evaluate(() =>
      sessionStorage.getItem("smartretail.invitation.pending"),
    ),
    null,
  );
  pass("accepted-invitation-navigates-without-client-role-or-tenant");
  await s.close();
  for (const width of [390, 320]) {
    s = await session({ width });
    p = s.page;
    await p.getByText("Verificar mi correo", { exact: true }).click();
    assert.ok(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await p.screenshot({
      path: path.join(process.argv[2], `access-${width}.png`),
      fullPage: true,
    });
    pass(`login-and-verification-responsive-${width}`);
    await s.close();
  }
  assert.equal(externalRequests, 0);
  pass("zero-external-service-requests");
  console.log(JSON.stringify({ checks, externalRequests }));
} finally {
  await browser.close();
}
