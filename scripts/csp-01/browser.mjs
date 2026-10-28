import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  { chromium } = require("@playwright/test");
const base = process.env.CSP_TEST_URL?.replace(/\/login$/, "");
assert.ok(base && /^http:\/\/127\.0\.0\.1:\d+$/.test(base));
const browser = await chromium.launch({ headless: true });
let checks = 0,
  escapedRequests = 0;
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.cspViolations.push({
        directive: e.effectiveDirective,
        disposition: e.disposition,
      }),
    );
  });
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.origin === base) return route.continue();
    if (u.origin === "https://synthetic.supabase.co")
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: "{}",
      });
    escapedRequests++;
    return route.abort();
  });
  const page = await context.newPage();
  let firstNonce;
  for (const path of [
    "/login",
    "/forgot-password",
    "/reset-password",
    "/register",
    "/invite",
  ]) {
    const response = await page.goto(base + path);
    const h = response.headers();
    const mode = h["content-security-policy-report-only"]
      ? "report"
      : "enforce";
    assert.equal(mode, process.argv[2]);
    const value =
      h["content-security-policy-report-only"] || h["content-security-policy"];
    const nonce = value.match(/'nonce-([^']+)'/)?.[1];
    assert.ok(nonce);
    if (firstNonce) assert.notEqual(nonce, firstNonce);
    else firstNonce = nonce;
    assert.ok(!value.includes(" 'unsafe-eval'"));
    assert.ok(
      !value
        .split(";")
        .find((x) => x.trim().startsWith("script-src "))
        .includes("unsafe-inline"),
    );
    await page.locator("body").waitFor();
    await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
    assert.ok(
      await page.evaluate(() => !!document.documentElement.dataset.theme),
    );
    assert.ok(await page.evaluate(() => document.styleSheets.length > 0));
    assert.equal(h["x-frame-options"], "DENY");
    assert.equal(h["x-content-type-options"], "nosniff");
    checks++;
  }
  const assets = await page.evaluate(async () => {
    const image = new Image();
    image.src =
      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
    const loaded = await new Promise((resolve) => {
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
    });
    return {
      image: loaded,
      font: !!getComputedStyle(document.body).fontFamily,
    };
  });
  assert.deepEqual(assets, { image: true, font: true });
  checks++;
  await page.goto(base + "/login");
  await page.waitForTimeout(200);
  const allowed = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const x = new XMLHttpRequest();
        x.open("GET", "https://synthetic.supabase.co/auth/v1/health");
        x.onload = () => resolve(x.status === 200);
        x.onerror = () => resolve(false);
        x.send();
      }),
  );
  assert.equal(allowed, true);
  checks++;
  await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = "window.untrustedScriptRan=true";
    document.body.append(s);
  });
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => !!window.untrustedScriptRan),
    process.argv[2] === "report",
  );
  checks++;
  if (process.argv[2] === "enforce") {
    await page.evaluate(() => {
      const b = document.createElement("button");
      b.id = "csp-negative";
      b.textContent = "Synthetic CSP check";
      b.setAttribute("onclick", "window.inlineHandlerRan=true");
      document.body.append(b);
    });
    await page.locator("#csp-negative").click();
    assert.equal(await page.evaluate(() => !!window.inlineHandlerRan), false);
    checks++;
    const denied = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const x = new XMLHttpRequest();
          x.open("GET", "https://blocked.example.invalid/probe");
          x.onload = () => resolve(false);
          x.onerror = () => resolve(true);
          x.send();
        }),
    );
    assert.equal(denied, true);
    checks++;
    await page.evaluate(() => {
      const script = document.createElement("script");
      script.src = "https://blocked.example.invalid/probe.js";
      document.body.append(script);
    });
    await page.waitForTimeout(100);
    assert.equal(escapedRequests, 0);
    checks++;
    const wasm = await page.evaluate(async () => {
      try {
        await WebAssembly.compile(
          new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
        );
        return true;
      } catch {
        return false;
      }
    });
    assert.equal(wasm, true);
    checks++;
  }
  // Static error fallback is intentionally measured, not silently made dynamic.
  for (const path of [
    "/csp-synthetic-not-found",
    "/settings/csp-synthetic-not-found",
  ]) {
    const fallback = await page.goto(base + path);
    await page.waitForTimeout(100);
    assert.equal(fallback.status(), 404);
    const policy = fallback.headers()["content-security-policy"];
    assert.ok(policy.includes("frame-ancestors 'none'"));
    assert.ok(policy.includes("script-src 'none'"));
    assert.ok(
      (await page.evaluate(() => window.cspViolations)).every((v) =>
        v.directive.startsWith("script-src"),
      ),
    );
    checks++;
  }
  console.log(
    JSON.stringify({
      mode: process.argv[2],
      checks,
      escapedRequests,
      staticFallbackScriptProtection: true,
    }),
  );
  await context.close();
} finally {
  await browser.close();
}
