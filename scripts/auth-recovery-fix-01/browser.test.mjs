// Real React/Chromium; synthetic codes and intercepted HTTP only.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const root = process.cwd();
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
const component = path
  .join(root, "apps/web/app/components/password-form.tsx")
  .replaceAll("\\", "/");
const result = await build({
  configFile: false,
  envDir: false,
  root,
  logLevel: "silent",
  plugins: [
    {
      name: "recovery-fixture",
      enforce: "pre",
      resolveId(id) {
        if (id.replaceAll("\\", "/").endsWith("/recovery-fixture.tsx"))
          return "\0recovery-fixture.tsx";
        if (["next/link", "../../lib/supabase/client"].includes(id))
          return "\0recovery-shim.tsx";
      },
      load(id) {
        if (id === "\0recovery-shim.tsx")
          return `import React from "react";
          export default function Link(p){return React.createElement("a",p)}
          export function browserAuth(){window.sdkCalls++;throw Error("UNEXPECTED_BROWSER_AUTH")}`;
        if (id === "\0recovery-fixture.tsx")
          return `import React from "react";import{createRoot}from"react-dom/client";
          import PasswordForm from ${JSON.stringify(component)};
          window.React=React;window.sdkCalls=0;
          createRoot(document.getElementById("root")).render(
            React.createElement(React.StrictMode,null,React.createElement(PasswordForm,{mode:"reset"})))`;
      },
    },
  ],
  resolve: {
    alias: [
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
      entry: path.join(root, "recovery-fixture.tsx"),
      name: "RecoveryFixture",
      formats: ["iife"],
    },
  },
});
const chunk = (Array.isArray(result) ? result[0] : result).output.find(
  (x) => x.type === "chunk",
);
assert.ok(chunk);
assert.equal(
  Object.keys(chunk.modules).some((id) =>
    /@supabase\/|\/next\/dist\//.test(id.replaceAll("\\", "/")),
  ),
  false,
);
const html = `<html><head><meta charset="utf-8"></head><body><div id="root"></div><script>${chunk.code.replaceAll("</script", "<\\/script")}</script></body></html>`;
const browser = await chromium.launch({ headless: true });
let checks = 0,
  externalRequests = 0;
const pass = (name) => {
  checks++;
  console.log(JSON.stringify({ name, result: "PASS" }));
};
try {
  for (const mode of ["valid", "invalid", "expired", "used", "network"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const calls = [],
      errors = [];
    let finish;
    page.on("pageerror", (error) => {
      errors.push("PAGE_ERROR");
      console.error(error.message);
    });
    await page.route("**/*", async (route) => {
      const r = route.request(),
        u = new URL(r.url());
      if (u.origin !== "http://127.0.0.1:55997") {
        externalRequests++;
        return route.abort();
      }
      if (r.method() === "GET")
        return route.fulfill({ contentType: "text/html", body: html });
      assert.equal(u.pathname, "/api/auth/reset-password");
      calls.push(r.postDataJSON());
      assert.equal(new URL(page.url()).search, "");
      if (mode === "network") return route.abort();
      await new Promise((resolve) => {
        finish = resolve;
      });
      return route.fulfill({
        status: ["expired", "used"].includes(mode) ? 401 : 200,
        contentType: "application/json",
        body: JSON.stringify(
          ["expired", "used"].includes(mode)
            ? { error: "Invalid recovery" }
            : { ok: true },
        ),
      });
    });
    await page.goto(
      "http://127.0.0.1:55997/reset-password" +
        (mode === "invalid"
          ? "?error=expired"
          : "?code=synthetic-code&sb_flow_id=synthetic_flow"),
    );
    if (mode === "invalid") {
      await page
        .getByText("Este enlace ya no es válido. Solicita uno nuevo.")
        .waitFor();
      assert.equal(calls.length, 0);
      assert.equal(new URL(page.url()).search, "");
      pass("invalid-link-no-exchange");
      await context.close();
      continue;
    }
    await page.locator('input[name="password"]').waitFor();
    assert.equal(calls.length, 0);
    assert.equal(await page.evaluate(() => window.sdkCalls), 0);
    pass(mode + "-strict-mode-no-auto-exchange");
    if (mode === "valid") {
      await page.reload();
      await page.locator('input[name="password"]').waitFor({ timeout: 3000 });
      assert.equal(calls.length, 0);
      pass("reload-preserves-unused-code");
      await page.locator('input[name="password"]').fill("Ficticia local 123!");
      await page
        .locator('input[name="confirmation"]')
        .fill("Different local 123!");
      await page.locator('button[type="submit"]').click();
      assert.equal(calls.length, 0);
      pass("mismatch-does-not-consume-code");
    }
    await page.locator('input[name="password"]').fill("Ficticia local 123!");
    await page
      .locator('input[name="confirmation"]')
      .fill("Ficticia local 123!");
    await page.locator('button[type="submit"]').evaluate((b) => {
      b.click();
      b.click();
    });
    await page.waitForFunction(
      () =>
        document
          .querySelector('input[name="password"]')
          ?.matches(":disabled") ||
        document.body.innerText.includes("resultado") ||
        document.body.innerText.includes("confirmar"),
    );
    if (mode !== "network") {
      assert.equal(calls.length, 1);
      finish();
    }
    if (["expired", "used"].includes(mode))
      await page
        .getByText("Este enlace ya no es válido. Solicita uno nuevo.")
        .waitFor();
    else if (mode === "valid")
      await page.getByText(/Contraseña actualizada/).waitFor();
    else
      await page
        .getByText(/confirmar|resultado/i)
        .first()
        .waitFor();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].code, "synthetic-code");
    assert.equal(calls[0].flowId, "synthetic_flow");
    assert.deepEqual(errors, []);
    pass(mode + "-single-submit-safe-outcome");
    await context.close();
  }
  assert.equal(externalRequests, 0);
  console.log(
    JSON.stringify({ checks, externalRequests, realProvider: false }),
  );
} finally {
  await browser.close();
}
