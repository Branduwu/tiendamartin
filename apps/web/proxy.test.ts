import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({
  claims: vi.fn(),
  status: vi.fn(),
  repo: vi.fn(),
  tenants: vi.fn(),
  client: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./lib/database", () => ({
  platformForUser: m.repo,
  tenantsForUser: m.tenants,
}));
vi.mock("./lib/supabase/config", () => ({
  authConfiguration: () => ({ url: "https://example.test", key: "public-key" }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: m.client,
}));
import { config, proxy } from "./proxy";
const actor = "550e8400-e29b-41d4-a716-446655440020",
  tenant = "550e8400-e29b-41d4-a716-446655440001";
beforeEach(() => {
  vi.stubEnv("APP_ORIGIN", "");
  vi.clearAllMocks();
  m.client.mockReturnValue({ auth: { getClaims: m.claims } });
  m.claims.mockResolvedValue({ data: { claims: { sub: actor } }, error: null });
  m.repo.mockReturnValue({ tenantStatus: m.status });
  m.status.mockResolvedValue(undefined);
  m.tenants.mockResolvedValue([{ tenantId: tenant }]);
});
afterEach(() => vi.unstubAllEnvs());

it("sets Secure host-only SameSite=Lax cookies on HTTPS", async () => {
  await proxy(new NextRequest("https://app.smartretailapp.live/products"));
  expect(m.client.mock.calls[0]?.[2].cookieOptions).toEqual({
    secure: true,
    sameSite: "lax",
    path: "/",
  });
});

it("keeps HTTP loopback development usable without broadening cookie scope", async () => {
  await proxy(new NextRequest("http://localhost:3000/products"));
  expect(m.client.mock.calls[0]?.[2].cookieOptions).toEqual({
    secure: false,
    sameSite: "lax",
    path: "/",
  });
});

it("redirects anonymous legacy navigation to the configured app host", async () => {
  vi.stubEnv("APP_ORIGIN", "https://app.smartretailapp.live");
  m.claims.mockResolvedValue({ data: null, error: null });
  const response = await proxy(
    new NextRequest("https://smartretail-sepia.vercel.app/login?next=invite"),
  );
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    "https://app.smartretailapp.live/login?next=invite",
  );
});

it("preserves verified legacy callback sessions through onboarding and products", async () => {
  vi.stubEnv("APP_ORIGIN", "https://app.smartretailapp.live");
  for (const path of ["/onboarding", "/products"])
    expect(
      (
        await proxy(
          new NextRequest("https://smartretail-sepia.vercel.app" + path),
        )
      ).status,
    ).toBe(200);
});

describe("private session refresh routes", () => {
  it("sends authenticated people without a company to onboarding", async () => {
    m.tenants.mockResolvedValue([]);
    const r = await proxy(new NextRequest("https://example.test/pos"));
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe("https://example.test/onboarding");
    expect(m.tenants).toHaveBeenCalledWith(actor);
  });
  it("does not redirect existing users or invitation/platform handoffs", async () => {
    for (const path of ["/products", "/onboarding", "/invite", "/platform"])
      expect(
        (await proxy(new NextRequest("https://example.test" + path))).status,
      ).toBe(200);
  });
  it("covers private pages and their mutation APIs", () => {
    expect(config.matcher).toEqual(
      expect.arrayContaining([
        "/pos/:path*",
        "/cash/:path*",
        "/sales/:path*",
        "/api/v1/cash/:path*",
        "/api/v1/sales/:path*",
        "/api/v1/suspended-sales/:path*",
      ]),
    );
  });
});
it("returns the suspension message only for the verified subject's own company", async () => {
  m.status.mockResolvedValue("suspended");
  const r = await proxy(
    new NextRequest("https://example.test/api/v1/products", {
      headers: {
        "x-tenant-id": tenant,
        "x-user-id": tenant,
        "x-role": "platform_admin",
      },
    }),
  );
  expect(r.status).toBe(403);
  expect(await r.json()).toEqual({
    error: "Esta empresa se encuentra suspendida. Contacta al administrador.",
  });
  expect(m.repo).toHaveBeenCalledWith(actor);
  expect(m.status).toHaveBeenCalledWith(tenant);
});
it("leaves foreign or unauthenticated scopes to denying handlers without revealing suspension", async () => {
  const r = await proxy(
    new NextRequest("https://example.test/api/v1/products", {
      headers: { "x-tenant-id": tenant },
    }),
  );
  expect(r.status).toBe(200);
  m.claims.mockResolvedValueOnce({
    data: null,
    error: new Error("Invalid claims"),
  });
  m.repo.mockClear();
  await proxy(
    new NextRequest("https://example.test/api/v1/products", {
      headers: { "x-tenant-id": tenant, "x-user-id": actor },
    }),
  );
  expect(m.repo).not.toHaveBeenCalled();
});
