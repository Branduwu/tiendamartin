import { beforeEach, expect, it, vi } from "vitest";
import {
  createSaleDraft,
  addSaleProduct,
  quantity,
  completeSale,
} from "@smartretail/domain";
import {
  PermissionDeniedError,
  SaleIdempotencyConflictError,
  SaleNotFoundError,
} from "@smartretail/application";
import { productInput } from "./product-mapping";
import { storedSaleDto } from "./sale-mapping";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  repo: vi.fn(),
  run: vi.fn(),
  read: vi.fn(),
}));
vi.mock("./auth", () => ({ verifiedUserId: mocks.user }));
vi.mock("./database", () => ({ salesForUser: mocks.repo }));
import { POST } from "../app/api/v1/sales/route";
import { GET } from "../app/api/v1/sales/[id]/route";
const user = "550e8400-e29b-41d4-a716-446655440020",
  tenant = "550e8400-e29b-41d4-a716-446655440001",
  id = "550e8400-e29b-41d4-a716-446655440010",
  location = "550e8400-e29b-41d4-a716-446655440011";
const product = productInput(id, {
  name: "Café",
  sku: "CAFE",
  unit: "piece",
  status: "active",
  purchaseCost: { currency: "MXN", minorUnits: "100" },
  salePrice: { currency: "MXN", minorUnits: "200" },
});
const draft = addSaleProduct(
  createSaleDraft(id),
  product,
  quantity("piece", 1000n),
);
const recorded = {
  shiftId: null,
  sale: completeSale(draft),
  payments: [{ method: "cash" as const, amount: draft.total }],
  locationId: location,
  tenantId: tenant,
  createdBy: user,
  createdAt: "2026-10-02T12:00:00.000Z",
};
const dto = storedSaleDto(recorded);
const body = {
  draft: { ...dto.sale, status: "draft" },
  payments: dto.payments,
  locationId: location,
  movements: [
    { productId: id, movementId: "550e8400-e29b-41d4-a716-446655440013" },
  ],
};
const request = (input: unknown = body, headers: Record<string, string> = {}) =>
  new Request("https://example.test/api/v1/sales", {
    method: "POST",
    headers: {
      origin: "https://example.test",
      "content-type": "application/json",
      "x-tenant-id": tenant,
      ...headers,
    },
    body: JSON.stringify(input),
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.user.mockResolvedValue(user);
  mocks.repo.mockReturnValue({ runSale: mocks.run, readSale: mocks.read });
  mocks.run.mockResolvedValue({ recorded, replayed: false });
  mocks.read.mockResolvedValue(recorded);
});
it("returns 401 without verified session before DB", async () => {
  mocks.user.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(401);
  expect(mocks.repo).not.toHaveBeenCalled();
});
it("rejects cross-origin mutation", async () => {
  expect(
    (await POST(request(body, { origin: "https://evil.test" }))).status,
  ).toBe(403);
  expect(mocks.run).not.toHaveBeenCalled();
});
it("rejects extra identity/role and number money", async () => {
  expect(
    (await POST(request({ ...body, userId: user, role: "owner" }))).status,
  ).toBe(400);
  expect(
    (
      await POST(
        request({
          ...body,
          payments: [
            { method: "cash", amount: { currency: "MXN", minorUnits: 200 } },
          ],
        }),
      )
    ).status,
  ).toBe(400);
});
it("creates with trusted context and 201", async () => {
  const response = await POST(
    request(body, { "x-user-id": "forged", "x-role": "owner" }),
  );
  expect(response.status).toBe(201);
  expect(mocks.repo).toHaveBeenCalledWith(user, tenant);
  expect((await response.json()).recorded.sale.total.minorUnits).toBe("200");
});
it("retry maps to 200", async () => {
  mocks.run.mockResolvedValue({ recorded, replayed: true });
  expect((await POST(request())).status).toBe(200);
});
it("permission and idempotency failures map to 403 and 409", async () => {
  mocks.run.mockRejectedValue(new PermissionDeniedError());
  expect((await POST(request())).status).toBe(403);
  mocks.run.mockRejectedValue(new SaleIdempotencyConflictError());
  expect((await POST(request())).status).toBe(409);
});
it("GET returns snapshot and missing sale returns 404", async () => {
  const req = new Request(`https://example.test/api/v1/sales/${id}`, {
    headers: { "x-tenant-id": tenant },
  });
  expect((await GET(req, { params: Promise.resolve({ id }) })).status).toBe(
    200,
  );
  mocks.read.mockRejectedValue(new SaleNotFoundError());
  expect((await GET(req, { params: Promise.resolve({ id }) })).status).toBe(
    404,
  );
});
it("unexpected SQL errors remain sanitized", async () => {
  mocks.run.mockRejectedValue(
    new Error("SQL password=fictional-private-value"),
  );
  const response = await POST(request());
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("fictional-private-value");
});
