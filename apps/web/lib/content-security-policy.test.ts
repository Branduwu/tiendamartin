import { afterEach, expect, it, vi } from "vitest";
import {
  contentSecurityPolicy,
  pageSecurityPolicy,
  nonceDocumentPath,
} from "./content-security-policy";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import nextConfig from "../next.config";
const nonce = Buffer.alloc(32, 1).toString("base64");
afterEach(() => vi.unstubAllEnvs());
it("denies scripts on static responses while allowing the fixed worker assets", async () => {
  const rules = await nextConfig.headers!();
  const global = rules
    .find((r) => r.source === "/:path*")!
    .headers.find((h) => h.key === "Content-Security-Policy")!.value;
  expect(global).toContain("script-src 'none'");
  expect(global).not.toContain("unsafe-inline");
  const worker = rules.find((r) => r.source === "/document-engine/:asset*")!
    .headers[0]!.value;
  expect(worker).toContain("script-src 'self' 'wasm-unsafe-eval'");
});
it("covers current page routes without attaching nonces to unknown static fallbacks", () => {
  const files = readdirSync(resolve("apps/web/app"), { recursive: true }).map(
    String,
  );
  for (const file of files.filter((f) => /page\.tsx$/.test(f))) {
    const route =
      "/" +
      file
        .replaceAll("\\", "/")
        .replace(/(^|\/)page\.tsx$/, "")
        .replace(/\[[^/]+\]/g, "synthetic");
    expect(nonceDocumentPath(route), route).toBe(true);
  }
  for (const path of [
    "/unknown",
    "/settings/unknown",
    "/_not-found",
    "/_global-error",
    "/api/v1/profile",
  ])
    expect(pageSecurityPolicy(path)).toBeNull();
});
it("restricts scripts without production JS eval or inline exceptions", () => {
  const policy = contentSecurityPolicy({
    nonce,
    authUrl: "https://synthetic.supabase.co/path",
  });
  expect(policy).toContain("connect-src 'self' https://synthetic.supabase.co;");
  expect(policy).not.toContain(" 'unsafe-eval'");
  expect(
    policy.split(";").find((x) => x.trim().startsWith("script-src ")),
  ).not.toContain("unsafe-inline");
  for (const rule of [
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src-attr 'none'",
  ])
    expect(policy).toContain(rule);
  expect(policy).not.toContain("*");
  expect(policy).not.toContain("report-uri");
});
it.each(["http://remote.invalid", "https://user:pass@host.invalid", "invalid"])(
  "rejects unsafe Auth origin %s",
  (authUrl) => {
    expect(() => contentSecurityPolicy({ nonce, authUrl })).toThrow();
  },
);
it("rejects forged nonce and generates independent cryptographic nonces", () => {
  expect(() => contentSecurityPolicy({ nonce: "injected" })).toThrow();
  expect(pageSecurityPolicy("/login")?.nonce).not.toEqual(
    pageSecurityPolicy("/login")?.nonce,
  );
  expect(pageSecurityPolicy("/api/v1/profile")).toBeNull();
});
it("allows ReportOnly only on explicitly configured local non-Vercel staging", () => {
  vi.stubEnv("CSP_REPORT_ONLY", "true");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("APP_ORIGIN", "https://app.smartretailapp.live");
  expect(pageSecurityPolicy("/login")?.header).toBe("Content-Security-Policy");
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3066");
  expect(pageSecurityPolicy("/login")?.header).toBe(
    "Content-Security-Policy-Report-Only",
  );
  vi.stubEnv("VERCEL", "1");
  expect(pageSecurityPolicy("/login")?.header).toBe("Content-Security-Policy");
});
