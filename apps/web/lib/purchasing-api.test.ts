import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { PermissionDeniedError } from "@smartretail/application";
import {
  PurchaseConflictError,
  productId,
  quantity,
  money,
} from "@smartretail/domain";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  factory: vi.fn(),
  read: vi.fn(),
  receive: vi.fn(),
  create: vi.fn(),
  suppliers: vi.fn(),
}));
vi.mock("./auth", () => ({ verifiedUserId: mocks.identity }));
vi.mock("./database", () => ({ purchasingForUser: mocks.factory }));
import { handlePurchasing } from "./purchasing-api";
const tenant = "550e8400-e29b-41d4-a716-446655440001",
  user = "550e8400-e29b-41d4-a716-446655440002",
  id = "550e8400-e29b-41d4-a716-446655440003";
const request = (body?: unknown, origin = "http://localhost") =>
  new Request("http://localhost/api/v1/purchases", {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-tenant-id": tenant,
      origin,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue(user);
  mocks.factory.mockReturnValue({
    readPurchase: mocks.read,
    receivePurchaseOrder: mocks.receive,
    createPurchase: mocks.create,
    listSuppliers: mocks.suppliers,
  });
});
describe("purchasing API boundary", () => {
  it("anonymous cannot access read or mutation", async () => {
    mocks.identity.mockResolvedValue(undefined);
    expect((await handlePurchasing(request(), "suppliers")).status).toBe(401);
    expect((await handlePurchasing(request({}), "receive", id)).status).toBe(
      401,
    );
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("server identity and validated tenant are the only repository context", async () => {
    mocks.suppliers.mockResolvedValue([]);
    expect((await handlePurchasing(request(), "suppliers")).status).toBe(200);
    expect(mocks.factory).toHaveBeenCalledWith(
      user,
      tenant,
      expect.any(String),
    );
  });
  it("cross-origin request is denied before receipt execution", async () => {
    expect(
      (
        await handlePurchasing(
          request({ id, lines: [] }, "https://foreign.invalid"),
          "receive",
          id,
        )
      ).status,
    ).toBe(403);
    expect(mocks.receive).not.toHaveBeenCalled();
  });
  it("strict DTO rejects forged identity, number amount and unknown keys", async () => {
    for (const body of [
      {
        id,
        lines: [
          { productId: id, quantity: { unit: "piece", milliUnits: 1000 } },
        ],
      },
      { id, role: "owner", userId: user, lines: [] },
    ]) {
      expect(
        (await handlePurchasing(request(body), "receive", id)).status,
      ).toBe(400);
    }
    expect(mocks.receive).not.toHaveBeenCalled();
  });
  it("permission denial and durable conflict have sanitized status", async () => {
    mocks.receive
      .mockRejectedValueOnce(new PermissionDeniedError())
      .mockRejectedValueOnce(new PurchaseConflictError("private detail"));
    const body = {
      id: randomUUID(),
      lines: [
        { productId: id, quantity: { unit: "piece", milliUnits: "1000" } },
      ],
    };
    expect((await handlePurchasing(request(body), "receive", id)).status).toBe(
      403,
    );
    const conflict = await handlePurchasing(request(body), "receive", id);
    expect(conflict.status).toBe(409);
    expect(await conflict.text()).not.toContain("private detail");
  });
  it("canonical string becomes exact domain bigint and response stays JSON serializable", async () => {
    const order = {
      id,
      tenantId: tenant,
      supplierId: id,
      locationId: id,
      status: "received",
      createdBy: user,
      createdAt: "2026-10-02T00:00:00.000Z",
      lines: [
        {
          productId: productId(id),
          quantityOrdered: quantity("piece", 1000n),
          quantityReceived: quantity("piece", 1000n),
          unitCost: money(777n),
        },
      ],
    };
    mocks.receive.mockResolvedValue({ order, replayed: false });
    const response = await handlePurchasing(
      request({
        id,
        lines: [
          { productId: id, quantity: { unit: "piece", milliUnits: "1000" } },
        ],
      }),
      "receive",
      id,
    );
    expect(response.status).toBe(200);
    expect(mocks.receive.mock.calls[0]?.[1].lines[0].quantity.milliUnits).toBe(
      1000n,
    );
    expect((await response.json()).purchase.lines[0].unitCost.minorUnits).toBe(
      "777",
    );
  });
  it("unexpected SQL detail never enters response or logs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.read.mockRejectedValue(
      new Error("postgres password SQL internal detail"),
    );
    const response = await handlePurchasing(request(), "purchase", id);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("postgres password");
    expect(log.mock.calls.flat().join()).not.toContain("SQL internal");
    log.mockRestore();
  });
});
