import { beforeEach, it, expect, vi } from "vitest";
import { ReceivableConflictError } from "@smartretail/domain";
import { PermissionDeniedError } from "@smartretail/application";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({
  user: vi.fn(),
  repo: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  collect: vi.fn(),
  summary: vi.fn(),
}));
vi.mock("./auth", () => ({ verifiedUserId: m.user }));
vi.mock("./database", () => ({ receivablesForUser: m.repo }));
import { handleReceivables } from "./receivables-api";
const id = "550e8400-e29b-41d4-a716-446655440001",
  input = {
    id,
    method: "card",
    amount: { currency: "MXN", minorUnits: "100" },
  };
const request = (
  body: unknown = input,
  origin = "https://example.test",
  query = "",
) =>
  new Request("https://example.test/api/v1/receivables" + query, {
    method: "POST",
    headers: { origin, "x-tenant-id": id, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.user.mockResolvedValue(id);
  m.repo.mockReturnValue({
    list: m.list,
    read: m.read,
    collect: m.collect,
    summary: m.summary,
  });
  m.collect.mockResolvedValue({ replayed: false });
  m.list.mockResolvedValue([]);
});
it("anonymous collection denied before database", async () => {
  m.user.mockResolvedValue(null);
  expect((await handleReceivables(request(), "pay", id)).status).toBe(401);
  expect(m.repo).not.toHaveBeenCalled();
});
it("same origin and strict body prevent role tenant and non-money manipulation", async () => {
  for (const value of [
    { ...input, role: "owner" },
    { ...input, tenantId: id },
    { ...input, amount: { currency: "MXN", minorUnits: 100 } },
  ])
    expect((await handleReceivables(request(value), "pay", id)).status).toBe(
      400,
    );
  expect(
    (await handleReceivables(request(input, "https://foreign.test"), "pay", id))
      .status,
  ).toBe(403);
  expect(m.collect).not.toHaveBeenCalled();
});
it("forwards only verified actor tenant parsed payment and correlation", async () => {
  expect((await handleReceivables(request(), "pay", id)).status).toBe(200);
  expect(m.repo).toHaveBeenCalledWith(id, id);
  expect(m.collect).toHaveBeenCalledWith(
    id,
    { ...input, amount: { currency: "MXN", minorUnits: 100n } },
    expect.stringMatching(/^[a-f0-9-]{36}$/),
  );
});
it("permission and concurrency conflicts are sanitized", async () => {
  m.collect.mockRejectedValueOnce(new PermissionDeniedError());
  expect((await handleReceivables(request(), "pay", id)).status).toBe(403);
  m.collect.mockRejectedValueOnce(new ReceivableConflictError("Private SQL"));
  const r = await handleReceivables(request(), "pay", id);
  expect(r.status).toBe(409);
  expect(await r.text()).not.toContain("Private SQL");
});
it("unknown SQL errors reveal no details", async () => {
  m.collect.mockRejectedValue(new Error("postgres password=private-query"));
  const r = await handleReceivables(request(), "pay", id);
  expect(r.status).toBe(500);
  expect(await r.text()).not.toMatch(/postgres|password|private-query/);
});
it("invalid duplicate and unexpected list query rejected", async () => {
  for (const q of [
    "?customerId=bad",
    "?customerId=" + id + "&customerId=" + id,
    "?role=owner",
  ])
    expect(
      (await handleReceivables(request(input, undefined, q), "list")).status,
    ).toBe(400);
  expect(m.list).not.toHaveBeenCalled();
});
