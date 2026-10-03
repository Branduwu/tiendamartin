import { beforeEach, expect, it, vi } from "vitest";
import { quantity } from "@smartretail/domain";
import {
  PermissionDeniedError,
  SuspensionConflictError,
} from "@smartretail/application";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({
  user: vi.fn(),
  repo: vi.fn(),
  lookup: vi.fn(),
  suspend: vi.fn(),
  list: vi.fn(),
  recover: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("./auth", () => ({ verifiedUserId: m.user }));
vi.mock("./database", () => ({ suspendedSalesForUser: m.repo }));
import { handleSuspendedSales } from "./suspended-sales-api";
const id = "550e8400-e29b-41d4-a716-446655440001";
const body = {
  id,
  locationId: id,
  lines: [{ productId: id, quantity: { unit: "piece", milliUnits: "1000" } }],
};
const record = {
  ...body,
  tenantId: id,
  createdBy: id,
  createdAt: "2026-10-02T12:00:00Z",
  status: "suspended",
  lines: [{ productId: id, quantity: quantity("piece", 1000n) }],
};
function req(
  input: unknown = body,
  origin = "https://example.test",
  path = "/api/v1/suspended-sales",
) {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    headers: { origin, "x-tenant-id": id, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.user.mockResolvedValue(id);
  m.repo.mockReturnValue({
    lookupBarcode: m.lookup,
    suspend: m.suspend,
    listSuspended: m.list,
    recoverSuspended: m.recover,
    cancelSuspended: m.cancel,
  });
  m.suspend.mockResolvedValue({ record, replayed: false });
  m.list.mockResolvedValue([]);
});
it("requires a verified session before lookup or persistence", async () => {
  m.user.mockResolvedValue(null);
  expect((await handleSuspendedSales(req(), "suspend")).status).toBe(401);
  expect(m.repo).not.toHaveBeenCalled();
});
it("denies cross-origin suspension and cancellation", async () => {
  for (const operation of ["suspend", "cancel"] as const)
    expect(
      (await handleSuspendedSales(req({}, "https://evil.test"), operation, id))
        .status,
    ).toBe(403);
  expect(m.suspend).not.toHaveBeenCalled();
  expect(m.cancel).not.toHaveBeenCalled();
});
it("rejects malformed quantities as 400 without coercion or a 500", async () => {
  for (const value of ["abc", "1e3", "1.2", 1000])
    expect(
      (
        await handleSuspendedSales(
          req({
            ...body,
            lines: [
              { productId: id, quantity: { unit: "piece", milliUnits: value } },
            ],
          }),
          "suspend",
        )
      ).status,
    ).toBe(400);
  expect(m.suspend).not.toHaveBeenCalled();
});
it("rejects forged actor/role/payment/price inputs", async () => {
  expect(
    (
      await handleSuspendedSales(
        req({ ...body, userId: id, role: "owner", payments: [] }),
        "suspend",
      )
    ).status,
  ).toBe(400);
  expect(m.suspend).not.toHaveBeenCalled();
});
it("creates and replays same stable ID using trusted identity", async () => {
  expect((await handleSuspendedSales(req(), "suspend")).status).toBe(201);
  expect(m.repo).toHaveBeenCalledWith(id, id);
  expect(m.suspend.mock.calls[0]?.[0].lines[0].quantity.milliUnits).toBe(1000n);
  m.suspend.mockResolvedValue({ record, replayed: true });
  expect((await handleSuspendedSales(req(), "suspend")).status).toBe(200);
});
it("distinguishes missing and inactive exact lookup; rejects extra query keys", async () => {
  const get = (path: string) =>
    new Request(`https://example.test${path}`, {
      headers: { "x-tenant-id": id },
    });
  expect(
    await (
      await handleSuspendedSales(
        get("/api/v1/products/lookup?barcode=123"),
        "barcode",
      )
    ).json(),
  ).toEqual({ status: "not_found" });
  expect(m.lookup).toHaveBeenCalledWith("123");
  expect(
    (
      await handleSuspendedSales(
        get("/api/v1/products/lookup?barcode=123&role=owner"),
        "barcode",
      )
    ).status,
  ).toBe(400);
});
it("maps permission and lifecycle conflicts without SQL details", async () => {
  m.list.mockRejectedValue(new PermissionDeniedError());
  expect(
    (
      await handleSuspendedSales(
        new Request("https://example.test/api/v1/suspended-sales", {
          headers: { "x-tenant-id": id },
        }),
        "list",
      )
    ).status,
  ).toBe(403);
  m.cancel.mockRejectedValue(new SuspensionConflictError());
  expect((await handleSuspendedSales(req({}), "cancel", id)).status).toBe(409);
});
it("sanitizes unexpected errors and bounds request bytes", async () => {
  m.suspend.mockRejectedValue(new Error("SQL password private-detail"));
  const response = await handleSuspendedSales(req(), "suspend");
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain("private-detail");
  expect(
    (await handleSuspendedSales(req({ padding: "x".repeat(17000) }), "suspend"))
      .status,
  ).toBe(400);
});
