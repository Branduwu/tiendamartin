import assert from "node:assert/strict";
export async function fixturePolicy() {
  const url = process.env.CSP_TEST_URL;
  if (!url) return null;
  assert.ok(/^http:\/\/127\.0\.0\.1:\d+\/login$/.test(url));
  const response = await fetch(url);
  const header = response.headers.has("content-security-policy-report-only")
    ? "content-security-policy-report-only"
    : "content-security-policy";
  const value = response.headers.get(header);
  assert.ok(value);
  const nonce = value.match(/'nonce-([^']+)'/)?.[1];
  assert.ok(nonce);
  return { header, value, nonce };
}
export function cspHtml(html, policy) {
  return policy
    ? html.replace("<script>", () => `<script nonce="${policy.nonce}">`)
    : html;
}
export async function observePolicy(page) {
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.cspViolations.push({
        directive: e.effectiveDirective,
        disposition: e.disposition,
        category: ["eval", "inline", "wasm-eval"].includes(e.blockedURI)
          ? e.blockedURI
          : "resource",
      }),
    );
  });
}
export async function assertPolicyClean(page) {
  assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
}
