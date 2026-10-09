import { afterEach, expect, it, vi } from "vitest";
import { appOrigin, canonicalPageRedirect } from "./app-origin";

const origin = "https://app.smartretailapp.live";
const legacy = "https://smartretail-sepia.vercel.app";
afterEach(() => vi.unstubAllEnvs());

it("uses explicit server configuration and permits local development", () => {
  vi.stubEnv("APP_ORIGIN", "");
  expect(appOrigin()).toBeUndefined();
  vi.stubEnv("APP_ORIGIN", origin);
  expect(appOrigin()?.origin).toBe(origin);
  vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
  expect(appOrigin()?.origin).toBe("http://localhost:3000");
});

it("rejects credentials, remote HTTP, paths and redirect parameters", () => {
  for (const value of [
    "invalid",
    "http://app.smartretailapp.live",
    "https://user:password@app.smartretailapp.live",
    origin + "/login",
    origin + "?next=https://example.test",
    origin + "#fragment",
    "javascript:alert(1)",
  ]) {
    vi.stubEnv("APP_ORIGIN", value);
    expect(() => appOrigin()).toThrow();
  }
});

it("redirects legacy page GET/HEAD preserving the path and query", () => {
  vi.stubEnv("APP_ORIGIN", origin);
  for (const method of ["GET", "HEAD"])
    expect(
      canonicalPageRedirect(
        new Request(legacy + "/login?next=invite", { method }),
      )?.href,
    ).toBe(origin + "/login?next=invite");
});

it("preserves legacy callbacks, APIs and mutations during transition", () => {
  vi.stubEnv("APP_ORIGIN", origin);
  for (const path of [
    "/auth/callback?code=test",
    "/auth",
    "/api/v1/health",
    "/api",
    "/_next/static/test.js",
  ])
    expect(canonicalPageRedirect(new Request(legacy + path))).toBeUndefined();
  expect(
    canonicalPageRedirect(new Request(legacy + "/login", { method: "POST" })),
  ).toBeUndefined();
});

it("does not trust forwarded hosts, redirect parameters or other domains", () => {
  vi.stubEnv("APP_ORIGIN", origin);
  for (const host of [origin, "http://localhost:3000", "https://example.test"])
    expect(
      canonicalPageRedirect(
        new Request(host + "/login", {
          headers: { "x-forwarded-host": "smartretail-sepia.vercel.app" },
        }),
      ),
    ).toBeUndefined();
  const redirected = canonicalPageRedirect(
    new Request(legacy + "//example.test?next=https://example.test"),
  );
  expect(redirected?.origin).toBe(origin);
});

it("does not redirect before configuration or back to the same origin", () => {
  vi.stubEnv("APP_ORIGIN", "");
  expect(canonicalPageRedirect(new Request(legacy))).toBeUndefined();
  vi.stubEnv("APP_ORIGIN", legacy);
  expect(canonicalPageRedirect(new Request(legacy))).toBeUndefined();
});

it("keeps verified legacy sessions on their own host after a callback", () => {
  vi.stubEnv("APP_ORIGIN", origin);
  for (const path of ["/auth/callback?code=test", "/onboarding", "/products"])
    expect(
      canonicalPageRedirect(new Request(legacy + path), true),
    ).toBeUndefined();
});
