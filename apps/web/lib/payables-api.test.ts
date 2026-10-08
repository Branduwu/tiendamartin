import { vi, it, expect, beforeEach } from "vitest";
import { PermissionDeniedError } from "@smartretail/application";
import { PayableConflictError } from "@smartretail/domain";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({
  user: vi.fn(),
  repo: vi.fn(),
  pay: vi.fn(),
  createExpense: vi.fn(),
  list: vi.fn(),
}));
vi.mock("./auth", () => ({ verifiedUserId: m.user }));
vi.mock("./database", () => ({ payablesForUser: m.repo }));
import { handlePayables } from "./payables-api";
const id = "550e8400-e29b-41d4-a716-446655440001",
  input = {
    id,
    method: "card",
    amount: { currency: "MXN", minorUnits: "100" },
  };
const req = (body: unknown = input, origin = "https://example.test") =>
  new Request("https://example.test/api/v1/payables", {
    method: "POST",
    headers: { origin, "x-tenant-id": id, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.user.mockResolvedValue(id);
  m.repo.mockReturnValue(m);
  m.pay.mockResolvedValue({ replayed: false });
});
it("anonymous denied before database", async () => {
  m.user.mockResolvedValue(null);
  expect((await handlePayables(req(), "pay", id)).status).toBe(401);
  expect(m.repo).not.toHaveBeenCalled();
});
it("strict body no forged actor role or number money and origin enforced", async () => {
  for (const body of [
    { ...input, role: "owner" },
    { ...input, createdBy: id },
    { ...input, amount: { currency: "MXN", minorUnits: 100 } },
  ])
    expect((await handlePayables(req(body), "pay", id)).status).toBe(400);
  expect(
    (await handlePayables(req(input, "https://evil.test"), "pay", id)).status,
  ).toBe(403);
  expect(m.pay).not.toHaveBeenCalled();
});
it("verified actor plus bigint forwarded and conflicts permission mapped", async () => {
  expect((await handlePayables(req(), "pay", id)).status).toBe(200);
  expect(m.repo).toHaveBeenCalledWith(id, id);
  expect(m.pay.mock.calls[0]?.[1].amount.minorUnits).toBe(100n);
  m.pay.mockRejectedValueOnce(new PayableConflictError());
  expect((await handlePayables(req(), "pay", id)).status).toBe(409);
  m.pay.mockRejectedValueOnce(new PermissionDeniedError());
  expect((await handlePayables(req(), "pay", id)).status).toBe(403);
});
it("SQL details sanitized and invalid query denied", async () => {
  m.pay.mockRejectedValueOnce(new Error("password SQL secret"));
  const r = await handlePayables(req(), "pay", id);
  expect(r.status).toBe(500);
  expect(await r.text()).not.toContain("SQL");
  const q = new Request("https://example.test/api/v1/payables?role=owner", {
    headers: { "x-tenant-id": id },
  });
  expect((await handlePayables(q, "list")).status).toBe(400);
});
