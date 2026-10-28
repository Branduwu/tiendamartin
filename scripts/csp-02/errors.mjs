import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  { chromium } = require("@playwright/test");
const normal = process.env.CSP_HEALTHY_URL || "http://127.0.0.1:3076";
const error = process.env.CSP_STATIC_ERROR_URL || "http://127.0.0.1:3078";
const interactive = process.env.CSP_INTERACTIVE_ERROR_URL;
for (const url of [normal, error, interactive].filter(Boolean))
  assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(url));
let checks = 0,
  externalRequests = 0;
const browser = await chromium.launch();
try {
  for (const [base, path, status, mode] of [
    [normal, "/does-not-exist", 404, "header"],
    [normal, "/settings/does-not-exist", 404, "header"],
    [error, "/synthetic-static-failure", 500, "header"],
    [error, "/settings/account", 500, "meta"],
  ]) {
    for (const js of [false, true]) {
      const c = await browser.newContext({ javaScriptEnabled: js });
      await c.route("**/*", (r) => {
        if (new URL(r.request().url()).origin === base) return r.continue();
        externalRequests++;
        return r.abort();
      });
      if (js)
        await c.addInitScript(() => {
          window.probeRan = false;
        });
      const p = await c.newPage();
      const response = await p.goto(base + path);
      assert.equal(response.status(), status);
      let allowedNonce;
      if (mode === "header")
        assert.ok(
          response
            .headers()
            ["content-security-policy"].includes("script-src 'none'"),
        );
      else {
        allowedNonce = response
          .headers()
          ["content-security-policy"].match(/'nonce-([^']+)'/)?.[1];
        assert.ok(allowedNonce);
        assert.ok(
          (
            await p
              .locator('meta[http-equiv="Content-Security-Policy"]')
              .getAttribute("content")
          ).includes("script-src 'none'"),
        );
      }
      assert.ok((await p.locator("h1:visible").count()) > 0);
      assert.equal(await p.locator("nav a[href]:visible").count(), 2);
      const html = await response.text();
      assert.ok(
        !/Synthetic CSP root failure|at RootLayout|node_modules\//.test(html),
      );
      if (status === 500)
        assert.ok(
          html.indexOf('http-equiv="Content-Security-Policy"') <
            html.indexOf("<script"),
        );
      if (js) {
        await p.evaluate((nonce) => {
          const s = document.createElement("script");
          if (nonce) s.nonce = nonce;
          s.textContent = "window.probeRan=true";
          document.body.append(s);
        }, allowedNonce);
        assert.equal(await p.evaluate(() => window.probeRan), false);
      }
      await p.locator('a[href="/onboarding"]').click();
      await p
        .getByRole("heading", { name: "Bienvenido de nuevo", exact: true })
        .waitFor();
      const again = await p.goto(base + path);
      assert.equal(again.status(), status);
      await p.locator('a[href="/login"]').click();
      await p
        .getByRole("heading", { name: "Bienvenido de nuevo", exact: true })
        .waitFor();
      checks++;
      await c.close();
    }
  }
  if (interactive) {
    const c = await browser.newContext();
    const p = await c.newPage();
    const response = await p.goto(interactive + "/login");
    assert.equal(response.status(), 500);
    assert.ok(
      response.headers()["content-security-policy"].includes("'nonce-"),
    );
    await p.getByRole("button", { name: "Reload", exact: true }).waitFor();
    const reload = p.waitForResponse((r) => r.request().isNavigationRequest());
    await p.getByRole("button", { name: "Reload", exact: true }).click();
    assert.equal((await reload).status(), 500);
    checks++;
    await c.close();
  }
  assert.equal(externalRequests, 0);
  console.log(
    JSON.stringify({
      checks,
      externalRequests,
      staticErrorsWithoutJavaScript: "PASS",
      interactiveErrorTested: !!interactive,
    }),
  );
} finally {
  await browser.close();
}
