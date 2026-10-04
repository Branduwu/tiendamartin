import { beforeEach, expect, it, vi } from "vitest";
import { PermissionDeniedError } from "@smartretail/application";
const m = vi.hoisted(() => ({
  user: vi.fn(),
  repo: vi.fn(),
  authorize: vi.fn(),
  list: vi.fn(),
  save: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./auth", () => ({ verifiedUserId: m.user }));
vi.mock("./database", () => ({ taxesForUser: m.repo }));
import { handleTaxes } from "./taxes-api";
const id = "550e8400-e29b-41d4-a716-446655440101",
  tenant = "550e8400-e29b-41d4-a716-446655440102";
const body = { id, name: "Tax", rate: "775", active: true };
const request = (value: unknown = body, origin = "https://example.test") =>
  new Request("https://example.test/api/v1/taxes", {
    method: "POST",
    headers: {
      "x-tenant-id": tenant,
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify(value),
  });
beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue(id);
  m.repo.mockReturnValue({
    authorize: m.authorize,
    listTaxProfiles: m.list,
    saveTaxProfile: m.save,
  });
  m.save.mockResolvedValue(body);
  m.list.mockResolvedValue([body]);
});
it("requires authentication and server-side membership for catalog reads", async () => {
  m.user.mockResolvedValue(null);
  expect((await handleTaxes(request(), "list")).status).toBe(401);
  expect(m.repo).not.toHaveBeenCalled();
  m.user.mockResolvedValue(id);
  m.list.mockRejectedValue(new PermissionDeniedError());
  expect((await handleTaxes(request(), "list")).status).toBe(403);
});
it("enforces manage permission and origin before any mutation", async () => {
  m.authorize.mockRejectedValue(new PermissionDeniedError());
  expect((await handleTaxes(request(), "create")).status).toBe(403);
  expect(m.save).not.toHaveBeenCalled();
  m.authorize.mockResolvedValue(undefined);
  expect(
    (await handleTaxes(request(body, "https://foreign.test"), "create")).status,
  ).toBe(403);
  expect(m.save).not.toHaveBeenCalled();
});
it("rejects client tenant actor and noncanonical rate while serializing exact values", async () => {
  for (const value of [
    { ...body, tenantId: tenant },
    { ...body, rate: 775 },
    { ...body, rate: "1.5" },
  ])
    expect((await handleTaxes(request(value), "create")).status).toBe(400);
  expect(m.save).not.toHaveBeenCalled();
  const r = await handleTaxes(request(), "create");
  expect(r.status).toBe(201);
  expect((await r.json()).profile.rate).toBe("775");
  expect(m.authorize).toHaveBeenCalledWith("taxes.manage");
});
it("sanitizes SQL failures without logging their details", async () => {
  m.save.mockRejectedValue(new Error("SQL host credential private details"));
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const r = await handleTaxes(request(), "create");
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("SQL");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("credential");
  } finally {
    spy.mockRestore();
  }
});
