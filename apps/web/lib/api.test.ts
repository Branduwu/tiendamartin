import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PermissionDeniedError,
  ProductNotFoundError,
} from "@smartretail/application";
import { DatabaseUniquenessConflictError } from "@smartretail/database";
import { productInput } from "./product-mapping";
import { decimalToMinorUnits, minorUnitsToDecimal } from "./money-input";
import {
  CreateProductSchema,
  UpdateProductSchema,
} from "@smartretail/contracts";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  claims: vi.fn(),
  server: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  edit: vi.fn(),
  tenants: vi.fn(),
  repo: vi.fn(),
}));
vi.mock("./supabase/server", () => ({ serverAuth: mocks.server }));
vi.mock("./database", () => ({
  productsForUser: mocks.repo,
  tenantsForUser: mocks.tenants,
}));
import { GET as tenants } from "../app/api/v1/tenants/route";
import { GET, POST } from "../app/api/v1/products/route";
import { PATCH } from "../app/api/v1/products/[id]/route";

const user = "550e8400-e29b-41d4-a716-446655440020";
const tenant = "550e8400-e29b-41d4-a716-446655440001";
const id = "550e8400-e29b-41d4-a716-446655440010";
const dto = {
  name: "Café",
  sku: "CAFE-1",
  barcode: "123",
  unit: "piece" as const,
  purchaseCost: { currency: "MXN" as const, minorUnits: "1250" },
  salePrice: { currency: "MXN" as const, minorUnits: "2000" },
  status: "active" as const,
};
function request(
  method = "GET",
  body?: unknown,
  extra: Record<string, string> = {},
) {
  return new Request("http://localhost:3000/api/v1/products", {
    method,
    headers: {
      "x-tenant-id": tenant,
      origin: "http://localhost:3000",
      "content-type": "application/json",
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.server.mockResolvedValue({ auth: { getClaims: mocks.claims } });
  mocks.claims.mockResolvedValue({
    data: { claims: { sub: user } },
    error: null,
  });
  mocks.repo.mockReturnValue({
    listProducts: mocks.list,
    createProduct: mocks.create,
    editProduct: mocks.edit,
  });
  mocks.list.mockResolvedValue([productInput(id, dto)]);
  mocks.create.mockImplementation(async (value) => value);
  mocks.edit.mockImplementation(async (_id, change) =>
    change(productInput(id, dto)),
  );
  mocks.tenants.mockResolvedValue([
    { tenantId: tenant, canWriteProducts: true },
  ]);
});
describe("API with controlled Auth boundary (not cloud E2E)", () => {
  it("absent session returns 401 before DB", async () => {
    mocks.claims.mockResolvedValue({ data: null, error: null });
    expect((await GET(request())).status).toBe(401);
    expect(mocks.repo).not.toHaveBeenCalled();
  });
  it("a failed verification cannot supply identity", async () => {
    mocks.claims.mockResolvedValue({
      data: { claims: { sub: user } },
      error: new Error("invalid signature"),
    });
    expect((await POST(request("POST", dto))).status).toBe(401);
    expect(mocks.repo).not.toHaveBeenCalled();
  });
  it("invalid verified subject is rejected", async () => {
    mocks.claims.mockResolvedValue({
      data: { claims: { sub: "not-uuid" } },
      error: null,
    });
    expect((await GET(request())).status).toBe(401);
  });
  it("verification network failure denies access", async () => {
    mocks.claims.mockRejectedValue(new Error("offline"));
    expect((await tenants(request())).status).toBe(401);
  });
  it("own tenants use only verified subject", async () => {
    const response = await tenants(
      request("GET", undefined, { "x-user-id": id, role: "owner" }),
    );
    expect(response.status).toBe(200);
    expect(mocks.tenants).toHaveBeenCalledWith(user);
  });
  it("list is serialized and verified subject builds context", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ products: [{ id, ...dto }] });
    expect(mocks.repo).toHaveBeenCalledWith(user, tenant);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("missing/invalid tenant returns 400", async () => {
    expect(
      (await GET(request("GET", undefined, { "x-tenant-id": "" }))).status,
    ).toBe(400);
  });
  it("foreign tenant is 403", async () => {
    mocks.list.mockRejectedValue(new PermissionDeniedError());
    expect((await GET(request())).status).toBe(403);
  });
  it("read-only member cannot write", async () => {
    mocks.create.mockRejectedValue(new PermissionDeniedError());
    expect((await POST(request("POST", dto))).status).toBe(403);
  });
  it("valid creation generates identity and preserves exact money", async () => {
    const response = await POST(request("POST", dto));
    expect(response.status).toBe(201);
    expect((await response.json()).product).toMatchObject(dto);
    expect(mocks.create.mock.calls[0]?.[0].purchaseCost.minorUnits).toBe(1250n);
  });
  it.each(["SKU", "barcode"])("%s conflict returns sanitized 409", async () => {
    mocks.create.mockRejectedValue(new DatabaseUniquenessConflictError());
    expect((await POST(request("POST", dto))).status).toBe(409);
  });
  it("number money and extra authority fields rejected", async () => {
    for (const value of [
      { ...dto, userId: user },
      { ...dto, purchaseCost: { currency: "MXN", minorUnits: 100 } },
    ])
      expect((await POST(request("POST", value))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("malformed JSON returns 400", async () => {
    const req = request("POST", dto);
    const bad = new Request(req.url, {
      method: "POST",
      headers: req.headers,
      body: "{",
    });
    expect((await POST(bad)).status).toBe(400);
  });
  it("oversized body is rejected even without content length", async () => {
    expect(
      (await POST(request("POST", { name: "a".repeat(17000) }))).status,
    ).toBe(400);
  });
  it.each(["https://evil.example", "null", ""])(
    "mutation rejects Origin %s",
    async (origin) => {
      expect((await POST(request("POST", dto, { origin }))).status).toBe(403);
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  it("cross-site Fetch Metadata rejected", async () => {
    expect(
      (await POST(request("POST", dto, { "sec-fetch-site": "cross-site" })))
        .status,
    ).toBe(403);
  });
  it("same-origin uses HTTP Host when Next normalizes its internal URL", async () => {
    expect(
      (
        await POST(
          request("POST", dto, {
            host: "127.0.0.1:3000",
            origin: "http://127.0.0.1:3000",
            "sec-fetch-site": "same-origin",
          }),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await POST(
          request("POST", dto, {
            host: "127.0.0.1:3000",
            origin: "http://localhost:3000",
            "x-forwarded-host": "localhost:3000",
          }),
        )
      ).status,
    ).toBe(403);
  });
  it("normalizes default Host ports and rejects combined authorities", async () => {
    const req = request("POST", dto, {
      host: "EXAMPLE.TEST:80",
      origin: "http://example.test",
    });
    expect((await POST(req)).status).toBe(201);
    expect(
      (
        await POST(
          request("POST", dto, {
            host: "example.test,evil.test",
            origin: "http://example.test,evil.test",
          }),
        )
      ).status,
    ).toBe(403);
  });
  it("patch uses operations including barcode removal and activation", async () => {
    const response = await PATCH(
      request("PATCH", { name: "Nuevo", barcode: null, status: "inactive" }),
      { params: Promise.resolve({ id }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.product.name).toBe("Nuevo");
    expect(body.product.status).toBe("inactive");
    expect(body.product).not.toHaveProperty("barcode");
  });
  it("foreign/nonexistent product maps to 404", async () => {
    mocks.edit.mockRejectedValue(new ProductNotFoundError());
    expect(
      (
        await PATCH(request("PATCH", { name: "Nuevo" }), {
          params: Promise.resolve({ id }),
        })
      ).status,
    ).toBe(404);
  });
  it("empty and identity-changing patches rejected", async () => {
    for (const patch of [{}, { id }, { tenantId: tenant }, { role: "owner" }])
      expect(UpdateProductSchema.safeParse(patch).success).toBe(false);
    expect(CreateProductSchema.safeParse({ ...dto, id }).success).toBe(false);
  });
  it("unexpected DB errors never expose SQL or credentials", async () => {
    mocks.list.mockRejectedValue(
      new Error("postgres password=secret SELECT * FROM retail.products"),
    );
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toMatch(/postgres|secret|SELECT|retail/);
  });
  it("storage overflow maps to 400", async () => {
    mocks.create.mockRejectedValue(new RangeError());
    expect((await POST(request("POST", dto))).status).toBe(400);
  });
});
describe("exact MXN input", () => {
  it.each([
    ["123.45", "12345"],
    ["10", "1000"],
    ["0.50", "50"],
    ["9007199254740993.01", "900719925474099301"],
  ])("%s converts exactly", (input, expected) => {
    expect(decimalToMinorUnits(input)).toBe(expected);
    expect(decimalToMinorUnits(minorUnitsToDecimal(expected))).toBe(expected);
  });
  it("rejects excess precision, exponents, whitespace and noncanonical input", () => {
    for (const input of [
      "1.001",
      "1e3",
      " 1",
      "1\n",
      "01",
      "-1",
      "1,25",
      "",
      "9".repeat(129),
    ])
      expect(() => decimalToMinorUnits(input)).toThrow();
  });
});
