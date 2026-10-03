import { beforeEach, expect, it, vi } from "vitest";
import { money } from "@smartretail/domain";
import {
  CashStateConflictError,
  PermissionDeniedError,
} from "@smartretail/application";
vi.mock("server-only", () => ({}));
const mock = vi.hoisted(() => ({
  user: vi.fn(),
  repo: vi.fn(),
  open: vi.fn(),
  current: vi.fn(),
  move: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./auth", () => ({ verifiedUserId: mock.user }));
vi.mock("./database", () => ({ cashForUser: mock.repo }));
import { handleCash } from "./cash-api";
const id = "550e8400-e29b-41d4-a716-446655440030",
  user = "550e8400-e29b-41d4-a716-446655440020",
  tenant = "550e8400-e29b-41d4-a716-446655440001";
const shift = {
  id,
  tenantId: tenant,
  locationId: id,
  openedBy: user,
  openedAt: "2026-10-02T12:00:00.000Z",
  openingCash: money(0n),
  status: "open" as const,
  salesCash: money(0n),
  cashIn: money(0n),
  cashOut: money(0n),
  expectedCash: money(0n),
  closedBy: null,
  closedAt: null,
  countedCash: null,
  difference: null,
};
const input = {
  id,
  locationId: id,
  openingCash: { currency: "MXN", minorUnits: "0" },
};
const request = (data: unknown = input, origin = "https://example.test") =>
  new Request("https://example.test/api/v1/cash/open", {
    method: "POST",
    headers: {
      origin,
      "x-tenant-id": tenant,
      "content-type": "application/json",
      "x-user-id": "forged",
      "x-role": "owner",
    },
    body: JSON.stringify(data),
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mock.user.mockResolvedValue(user);
  mock.repo.mockReturnValue({
    openShift: mock.open,
    currentShift: mock.current,
    moveCash: mock.move,
    closeShift: mock.close,
  });
  mock.open.mockResolvedValue(shift);
});
it("unauthenticated cash requests stop before DB", async () => {
  mock.user.mockResolvedValue(null);
  expect((await handleCash(request(), "open")).status).toBe(401);
  expect(mock.repo).not.toHaveBeenCalled();
});
it("cash rejects cross-origin", async () =>
  expect(
    (await handleCash(request(input, "https://evil.test"), "open")).status,
  ).toBe(403));
it("client identity and expected cash are rejected", async () => {
  expect(
    (
      await handleCash(
        request({ ...input, openedBy: user, expectedCash: input.openingCash }),
        "open",
      )
    ).status,
  ).toBe(400);
  expect(mock.open).not.toHaveBeenCalled();
});
it("trusted subject and exact bigint reach application", async () => {
  const r = await handleCash(request(), "open");
  expect(r.status).toBe(201);
  expect(mock.repo).toHaveBeenCalledWith(user, tenant);
  expect(mock.open.mock.calls[0]?.[0].openingCash.minorUnits).toBe(0n);
  expect((await r.json()).shift.expectedCash.minorUnits).toBe("0");
});
it("DB permission denial stays 403", async () => {
  mock.open.mockRejectedValue(new PermissionDeniedError());
  expect((await handleCash(request(), "open")).status).toBe(403);
});
it("concurrent/closed cash state returns 409", async () => {
  mock.open.mockRejectedValue(new CashStateConflictError());
  expect((await handleCash(request(), "open")).status).toBe(409);
});
it("SQL failure is sanitized", async () => {
  mock.open.mockRejectedValue(new Error("SELECT sensitive internal"));
  const r = await handleCash(request(), "open");
  expect(r.status).toBe(500);
  expect(await r.text()).not.toContain("SELECT");
});
