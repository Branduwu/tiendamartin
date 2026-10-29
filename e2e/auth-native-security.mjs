// Run against `next build && next start`, never against production.
// No traces, screenshots, cookies, request bodies or credential values persisted.
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const require = createRequire(new URL("../package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const origin = process.env.AUTH_SECURITY_ORIGIN ?? "http://localhost:3317";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))
  throw Error("Only a local production build is permitted");
const lab = "https://rxxfriwprfanhnjwcjla.supabase.co";
const browser = await chromium.launch();
const results = [];
const check = (ok, label) => {
  if (!ok) throw Error(label);
};
const fakePassword = randomBytes(24).toString("hex");
const fakeEmail = `native-${randomBytes(6).toString("hex")}@smartretail.invalid`;
const secrets = [fakePassword, fakeEmail];
function containsSecret(text) {
  for (let n = 0; n < 3; n++) {
    if (secrets.some((value) => text.includes(value))) return true;
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) break;
      text = decoded;
    } catch {
      break;
    }
  }
  return false;
}

async function scenario(name, task) {
  try {
    await task();
    results.push({ name, status: "PASS" });
  } catch (error) {
    // Never serialize Playwright errors: their call logs can contain inputs.
    results.push({
      name,
      status: "FAIL",
      error: error.message?.startsWith("CHECK:")
        ? error.message
        : "Controlled browser assertion failed",
    });
  }
}
async function session(mode = "normal") {
  const context = await browser.newContext({
    javaScriptEnabled: mode !== "no-js",
  });
  const page = await context.newPage();
  const audit = {
    urlLeaks: 0,
    reflected: 0,
    consoleLeaks: 0,
    thirdPartyLeaks: 0,
    nativeGet: 0,
    auth: [],
    csp: false,
  };
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await context.route("**/*", async (route) => {
    const r = route.request(),
      u = new URL(r.url());
    if (containsSecret(u.href) || containsSecret(r.headers().referer ?? "")) {
      audit.urlLeaks++;
      return route.abort();
    }
    if (u.origin !== origin && u.origin !== lab) {
      if (containsSecret(r.postData() ?? "")) audit.thirdPartyLeaks++;
      return route.abort();
    }
    if (r.resourceType() === "script") {
      if (mode === "blocked-js") return route.abort();
      if (mode === "slow") await gate;
    }
    if (u.origin === lab) {
      audit.auth.push({ path: u.pathname, method: r.method() });
      const headers = {
        "access-control-allow-origin": origin,
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "*",
      };
      if (r.method() === "OPTIONS")
        return route.fulfill({ status: 200, headers });
      if (u.pathname.endsWith("/token"))
        return route.fulfill({
          status: 400,
          headers,
          json: {
            code: "invalid_credentials",
            message: "Invalid login credentials",
          },
        });
      if (/\/(recover|resend|signup)$/.test(u.pathname))
        return route.fulfill({
          status: 200,
          headers,
          json: u.pathname.endsWith("signup")
            ? { user: null, session: null }
            : {},
        });
      return route.abort();
    }
    if (
      r.isNavigationRequest() &&
      r.method() === "GET" &&
      /password|nonce|otp|access_token|refresh_token/.test(u.search)
    )
      audit.nativeGet++;
    return route.continue();
  });
  page.on("console", (msg) => {
    if (containsSecret(msg.text())) audit.consoleLeaks++;
  });
  const pendingResponses = [];
  page.on("framenavigated", (frame) => {
    if (containsSecret(frame.url())) audit.urlLeaks++;
  });
  page.on("response", (response) => {
    if (containsSecret(response.headers().location ?? "")) audit.urlLeaks++;
    if (
      response.request().resourceType() === "document" ||
      /json|javascript|text/.test(response.headers()["content-type"] ?? "")
    ) {
      pendingResponses.push(
        response
          .text()
          .then((text) => {
            if (containsSecret(text)) audit.reflected++;
          })
          .catch(() => {}),
      );
    }
    if (
      new URL(response.url()).origin === origin &&
      response.request().isNavigationRequest()
    ) {
      const csp = response.headers()["content-security-policy"] ?? "";
      const script =
        csp.split(";").find((x) => x.trim().startsWith("script-src ")) ?? "";
      audit.csp ||=
        csp.includes("object-src 'none'") &&
        csp.includes("form-action 'self'") &&
        script.includes("'nonce-") &&
        !script.includes("'unsafe-inline'") &&
        !script.includes("'unsafe-eval'") &&
        !script.includes("*");
    }
  });
  const secure = async () => {
    await Promise.all(pendingResponses);
    if (containsSecret(page.url())) audit.urlLeaks++;
    check(
      audit.urlLeaks +
        audit.nativeGet +
        audit.reflected +
        audit.consoleLeaks +
        audit.thirdPartyLeaks ===
        0 && audit.csp,
      "CHECK: HTTP, URL, console and CSP safety",
    );
  };
  return { context, page, audit, release, secure };
}

for (const mode of ["no-js", "blocked-js", "slow"]) {
  for (const path of ["/login", "/register", "/forgot-password"]) {
    await scenario(
      `${mode} ${path}: button, Enter and native POST`,
      async () => {
        const s = await session(mode);
        try {
          await s.page.goto(origin + path, { waitUntil: "domcontentloaded" });
          const form = s.page.locator("form").first();
          check(
            (await form.getAttribute("method")) === "post",
            "CHECK: explicit POST",
          );
          check(
            (await form.getAttribute("action")) === path,
            "CHECK: fixed native destination",
          );
          const password = form.locator('input[name="password"]');
          const email = form.locator('input[name="email"]');
          check(
            await email.isDisabled(),
            "CHECK: credentials disabled before hydration",
          );
          await email.evaluate((el, value) => {
            el.value = value;
          }, fakeEmail);
          if (await password.count()) {
            check(
              await password.isDisabled(),
              "CHECK: password disabled before hydration",
            );
            await password.evaluate((el, value) => {
              el.value = value;
            }, fakePassword);
          }
          const button = form
            .locator('button[type="submit"], button:not([type])')
            .first();
          check(
            await button.isDisabled(),
            "CHECK: native submit control disabled",
          );
          await button.click({ force: true });
          await email.evaluate((el) => el.focus());
          check(
            await email.evaluate((el) => document.activeElement !== el),
            "CHECK: disabled credentials cannot gain focus for implicit submit",
          );
          await s.page.keyboard.press("Enter");
          check(
            s.audit.auth.length === 0,
            "CHECK: no authentication before hydration",
          );
          // Even bypassing disabled UI with native submit() must POST no controls.
          const responsePromise = s.page.waitForResponse(
            (r) =>
              r.request().isNavigationRequest() &&
              r.request().method() === "POST",
          );
          await form.evaluate((el) => el.submit());
          const response = await responsePromise;
          const request = response.request();
          check(
            !(request.postData() ?? "").includes(fakePassword) &&
              !(request.postData() ?? "").includes(fakeEmail),
            "CHECK: disabled fields excluded from native payload",
          );
          const text = await response.text();
          s.audit.reflected += secrets.some((value) => text.includes(value))
            ? 1
            : 0;
          if (mode === "no-js")
            check(
              text.includes("Activa JavaScript"),
              "CHECK: understandable no-JavaScript fallback",
            );
          if (mode === "slow") {
            s.release();
            await s.page.locator('input[name="email"]').first().waitFor();
            await s.page.waitForFunction(
              () =>
                !document.querySelector('input[name="email"]')?.disabled &&
                !document
                  .querySelector('input[name="email"]')
                  ?.matches(":disabled"),
            );
          }
          await s.secure();
        } finally {
          s.release();
          await s.context.close();
        }
      },
    );
  }
}

for (const submit of ["button", "Enter"]) {
  await scenario(`hydrated invalid login ${submit}`, async () => {
    const s = await session();
    try {
      await s.page.goto(origin + "/login");
      await s.page.locator('input[name="email"]').first().waitFor();
      await s.page.waitForFunction(
        () =>
          !document.querySelector('input[name="email"]')?.matches(":disabled"),
      );
      await s.page.locator('input[name="email"]').first().fill(fakeEmail);
      await s.page.locator('input[name="password"]').fill(fakePassword);
      if (submit === "button")
        await s.page
          .getByRole("button", { name: "Iniciar sesión", exact: true })
          .click();
      else await s.page.locator('input[name="password"]').press("Enter");
      await s.page.locator("#login-error").waitFor();
      check(
        s.audit.auth.filter(
          (x) => x.path.endsWith("/token") && x.method === "POST",
        ).length === 1,
        "CHECK: one POST login",
      );
      check(
        new URL(s.page.url()).pathname === "/login",
        "CHECK: invalid login stays on login",
      );
      await s.secure();
    } finally {
      await s.context.close();
    }
  });
}

for (const [path, button, expected] of [
  ["/forgot-password", "Enviar enlace", "/recover"],
  ["/register", "Crear cuenta", "/signup"],
  ["/login?confirmation=retry", "Reenviar verificación", "/resend"],
]) {
  await scenario(`hydrated ${expected}: simulated transport`, async () => {
    const s = await session();
    try {
      await s.page.goto(origin + path);
      if (expected === "/resend")
        await s.page.getByText("Verificar mi correo", { exact: true }).click();
      const form =
        expected === "/resend"
          ? s.page.locator("form").last()
          : s.page.locator("form").first();
      await s.page.waitForFunction(() =>
        [...document.querySelectorAll('input[name="email"]')].every(
          (x) => !x.matches(":disabled"),
        ),
      );
      await form.locator('input[name="email"]').fill(fakeEmail);
      if (expected === "/signup")
        await form.locator('input[name="password"]').fill(fakePassword);
      await form.getByRole("button", { name: button, exact: true }).click();
      await s.page
        .getByRole("status")
        .filter({ hasText: /Si existe|Si el correo puede|Si el correo tiene/ })
        .waitFor();
      check(
        s.audit.auth.some(
          (x) => x.path.endsWith(expected) && x.method === "POST",
        ),
        "CHECK: authentication POST transport",
      );
      check(
        !(await s.page.locator("body").innerText()).includes(fakePassword),
        "CHECK: no password reflection",
      );
      await s.secure();
    } finally {
      await s.context.close();
    }
  });
}

await scenario(
  "reset PKCE and invitation handoff: simulated transport",
  async () => {
    const s = await session();
    try {
      let resetPost = false;
      await s.context.route("**/api/auth/reset-password", async (route) => {
        const r = route.request(),
          body = JSON.parse(r.postData() ?? "{}");
        resetPost =
          r.method() === "POST" &&
          body.password === fakePassword &&
          body.confirmation === fakePassword &&
          Boolean(body.code);
        await route.fulfill({ status: 200, json: { ok: true } });
      });
      await s.page.goto(origin + "/reset-password?code=synthetic-pkce-input");
      await s.page.locator('input[name="password"]').waitFor();
      await s.page.locator('input[name="password"]').fill(fakePassword);
      await s.page.locator('input[name="confirmation"]').fill(fakePassword);
      await s.page
        .getByRole("button", { name: "Guardar contraseña", exact: true })
        .click();
      await s.page
        .getByRole("status")
        .filter({ hasText: "Contraseña actualizada" })
        .waitFor();
      check(resetPost, "CHECK: reset credentials only in POST payload");
      check(
        new URL(s.page.url()).search === "",
        "CHECK: existing PKCE input removed before exchange",
      );
      const inviteToken = randomBytes(32).toString("hex");
      await s.page.goto(origin + "/invite#token=" + inviteToken);
      await s.page
        .getByRole("link", { name: "Iniciar sesión", exact: true })
        .waitFor();
      check(
        new URL(s.page.url()).hash === "",
        "CHECK: invitation hash consumed",
      );
      await s.page
        .getByRole("link", { name: "Iniciar sesión", exact: true })
        .click();
      check(
        !s.page.url().includes(inviteToken),
        "CHECK: invitation not copied to login URL",
      );
      await s.secure();
    } finally {
      await s.context.close();
    }
  },
);

for (const mode of ["no-js", "blocked-js", "slow"]) {
  await scenario(
    `${mode} reset has no credential controls before hydration`,
    async () => {
      const s = await session(mode);
      try {
        await s.page.goto(
          origin + "/reset-password?code=synthetic-pkce-input",
          { waitUntil: "domcontentloaded" },
        );
        check(
          (await s.page.locator('input[type="password"], form').count()) === 0,
          "CHECK: reset cannot serialize credentials before hydration",
        );
        check(
          await s.page
            .getByRole("link", {
              name: "Solicitar un nuevo enlace",
              exact: true,
            })
            .isVisible(),
          "CHECK: safe recovery navigation",
        );
        await s.page.keyboard.press("Enter");
        await s.secure();
      } finally {
        s.release();
        await s.context.close();
      }
    },
  );
}
for (const path of [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password?code=synthetic-pkce-input",
]) {
  await scenario(
    `hydrated forced native submit ${path.split("?")[0]}`,
    async () => {
      const s = await session();
      try {
        await s.page.goto(origin + path);
        const form = s.page.locator("form").first();
        await form.waitFor();
        await s.page.waitForFunction(() => {
          const input = document.querySelector("form input");
          return input && !input.matches(":disabled");
        });
        await form.locator("input").evaluateAll(
          (els, values) =>
            els.forEach((el) => {
              el.value = el.type === "email" ? values.email : values.password;
            }),
          { email: fakeEmail, password: fakePassword },
        );
        const responsePromise = s.page.waitForResponse(
          (r) =>
            r.request().isNavigationRequest() &&
            r.request().method() === "POST",
        );
        await form.evaluate((el) => el.submit());
        const response = await responsePromise;
        check(
          response.request().method() === "POST" &&
            new URL(response.url()).search === "",
          "CHECK: native POST has canonical URL without query",
        );
        check(
          containsSecret(response.request().postData() ?? ""),
          "CHECK: native fallback exercised with enabled credentials",
        );
        await s.secure();
      } finally {
        await s.context.close();
      }
    },
  );
}
await scenario("CSP actually prevents unauthorized inline script", async () => {
  const s = await session();
  try {
    await s.page.goto(origin + "/login");
    await s.page.waitForFunction(
      () =>
        !document.querySelector('input[name="password"]')?.matches(":disabled"),
    );
    const blocked = await s.page.evaluate(() => {
      const script = document.createElement("script");
      script.textContent = "window.__credentialCspProbe=true";
      document.head.append(script);
      return window.__credentialCspProbe !== true;
    });
    check(blocked, "CHECK: unauthorized inline script must not execute");
    await s.secure();
  } finally {
    await s.context.close();
  }
});

await browser.close();
if (process.env.AUTH_SECURITY_RESULT)
  writeFileSync(
    process.env.AUTH_SECURITY_RESULT,
    JSON.stringify(results, null, 2),
  );
console.log(
  JSON.stringify({
    tests: results.length,
    passed: results.filter((x) => x.status === "PASS").length,
    results,
  }),
);
process.exitCode = results.some((x) => x.status !== "PASS") ? 1 : 0;
