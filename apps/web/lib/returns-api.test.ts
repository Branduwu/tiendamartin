import { beforeEach, expect, it, vi } from "vitest";
import {
  SaleReturnConflictError,
  quantity,
  money,
  saleReturnId,
  productId,
} from "@smartretail/domain";
import {
  PermissionDeniedError,
  SaleNotFoundError,
  CashStateConflictError,
} from "@smartretail/application";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({
  user: vi.fn(),
  repo: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
}));
vi.mock("./auth", () => ({ verifiedUserId: m.user }));
vi.mock("./database", () => ({ returnsForUser: m.repo }));
import { handleReturns } from "./returns-api";
const id = "550e8400-e29b-41d4-a716-446655440001",
  movementId = "550e8400-e29b-41d4-a716-446655440002";
const body = {
  id,
  lines: [
    {
      saleLineId: id,
      productId: id,
      quantity: { unit: "piece", milliUnits: "1000" },
      movementId,
    },
  ],
  refunds: [{ method: "card", amount: { currency: "MXN", minorUnits: "100" } }],
};
const record = {
  id: saleReturnId(id),
  saleId: id,
  status: "completed" as const,
  tenantId: id,
  locationId: id,
  createdBy: id,
  createdAt: "2026-10-02T12:00:00Z",
  shiftId: null,
  cashMovementId: null,
  lines: [
    {
      saleLineId: productId(id),
      productId: productId(id),
      quantity: quantity("piece", 1000n),
      refunded: money(100n),
    },
  ],
  total: money(100n),
  refunds: [{ method: "card" as const, amount: money(100n) }],
};
const req = (input: unknown = body, origin = "https://example.test") =>
  new Request(`https://example.test/api/v1/sales/${id}/returns`, {
    method: "POST",
    headers: { origin, "x-tenant-id": id, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.user.mockResolvedValue(id);
  m.repo.mockReturnValue({ returnSale: m.create, listReturns: m.list });
  m.create.mockResolvedValue({ record, replayed: false });
  m.list.mockResolvedValue([record]);
});
it("requires verified Auth before returns DB access", async () => {
  m.user.mockResolvedValue(null);
  expect((await handleReturns(req(), id, "create")).status).toBe(401);
  expect(m.repo).not.toHaveBeenCalled();
});
it("cross-origin refund is denied", async () => {
  expect(
    (await handleReturns(req(body, "https://evil.test"), id, "create")).status,
  ).toBe(403);
  expect(m.create).not.toHaveBeenCalled();
});
it("rejects price, refund-total and identity authority", async () => {
  for (const extra of [
    { total: "100" },
    { unitPrice: "1" },
    { userId: id },
    { role: "owner" },
  ])
    expect(
      (await handleReturns(req({ ...body, ...extra }), id, "create")).status,
    ).toBe(400);
  expect(m.create).not.toHaveBeenCalled();
});
it("malformed quantity produces 400, not an unknown 500", async () => {
  expect(
    (
      await handleReturns(
        req({
          ...body,
          lines: [
            {
              ...body.lines[0],
              quantity: { unit: "piece", milliUnits: "1e3" },
            },
          ],
        }),
        id,
        "create",
      )
    ).status,
  ).toBe(400);
});
it("creates a refund and repeats it using trusted identity and stable IDs", async () => {
  const r = await handleReturns(req(), id, "create");
  expect(r.status).toBe(201);
  expect((await r.json()).record.total.minorUnits).toBe("100");
  expect(m.repo).toHaveBeenCalledWith(id, id);
  m.create.mockResolvedValue({ record, replayed: true });
  expect((await handleReturns(req(), id, "create")).status).toBe(200);
});
it("maps permission, missing sale and conflict without leaking SQL", async () => {
  for (const [error, status] of [
    [new PermissionDeniedError(), 403],
    [new SaleNotFoundError(), 404],
    [new SaleReturnConflictError(), 409],
    [new CashStateConflictError(), 409],
  ] as const) {
    m.create.mockRejectedValue(error);
    expect((await handleReturns(req(), id, "create")).status).toBe(status);
  }
});
it("GET lists immutable returns and rejects invalid route ID", async () => {
  const get = new Request(`https://example.test/api/v1/sales/${id}/returns`, {
    headers: { "x-tenant-id": id },
  });
  expect((await handleReturns(get, id, "list")).status).toBe(200);
  expect((await handleReturns(get, "bad-id", "list")).status).toBe(400);
});
it("unexpected errors are sanitized and request bytes are bounded", async () => {
  m.create.mockRejectedValue(new Error("SQL private-return-value"));
  const r = await handleReturns(req(), id, "create");
  expect(r.status).toBe(500);
  expect(await r.text()).not.toContain("private-return-value");
  expect(
    (await handleReturns(req({ padding: "x".repeat(17000) }), id, "create"))
      .status,
  ).toBe(400);
});
