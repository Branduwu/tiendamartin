import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({
  claims: vi.fn(),
  status: vi.fn(),
  repo: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./lib/database", () => ({ platformForUser: m.repo }));
vi.mock("./lib/supabase/config", () => ({
  authConfiguration: () => ({ url: "https://example.test", key: "public-key" }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: m.claims } }),
}));
import { config, proxy } from "./proxy";
const actor = "550e8400-e29b-41d4-a716-446655440020",
  tenant = "550e8400-e29b-41d4-a716-446655440001";
beforeEach(() => {
  vi.clearAllMocks();
  m.claims.mockResolvedValue({ data: { claims: { sub: actor } }, error: null });
  m.repo.mockReturnValue({ tenantStatus: m.status });
  m.status.mockResolvedValue(undefined);
});

describe("private session refresh routes", () => {
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
