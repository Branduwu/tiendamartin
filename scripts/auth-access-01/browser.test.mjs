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
  let logoutFailed = mode === "logout-error",
    hold = null,
    release = null;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => logs.push(e.text()));
  const origin = "http://127.0.0.1:55998";
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
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
  await page.exposeFunction("fetchMock", async (url, body) => {
    calls.push({ operation: url, body });
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
  await page.goto(origin + path);
  await page
    .getByRole("heading", { name: "Acceso de prueba", exact: true })
    .waitFor();
  return {
    page,
    calls,
    context,
    mode,
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
